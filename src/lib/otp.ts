import { Buffer } from 'node:buffer';
import { randomInt, timingSafeEqual } from 'node:crypto';

interface StoredOTP {
  code: string;
  attempts: number;
  expiresAt: number;
}

const SEND_WINDOW_MS = 10 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3;
const MAX_ATTEMPTS = 3;
const OTP_TTL_MS = 5 * 60 * 1000;

// Verify-side lockout — survives OTP re-issue so an attacker can't reset the
// per-code attempt counter by simply requesting a new code.
const VERIFY_FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_VERIFY_FAILURES = 8;

type OtpScope = 'member' | 'staff';

// In-memory store for development; Upstash Redis for production.
// Stash on globalThis so the store survives Next.js dev HMR and is shared
// across route handlers (each route is bundled independently, so a plain
// module-scoped const would create a separate Map per route handler).
interface OtpGlobals {
  __kioskOtpStore?: Map<string, StoredOTP>;
  __kioskOtpSendTrackers?: Map<string, { count: number; windowStart: number }>;
  __kioskOtpVerifyFails?: Map<string, { count: number; windowStart: number }>;
}
const otpGlobals = globalThis as typeof globalThis & OtpGlobals;
const memoryStore: Map<string, StoredOTP>
  = otpGlobals.__kioskOtpStore ?? (otpGlobals.__kioskOtpStore = new Map<string, StoredOTP>());
const sendTrackers: Map<string, { count: number; windowStart: number }>
  = otpGlobals.__kioskOtpSendTrackers ?? (otpGlobals.__kioskOtpSendTrackers = new Map());
const verifyFails: Map<string, { count: number; windowStart: number }>
  = otpGlobals.__kioskOtpVerifyFails ?? (otpGlobals.__kioskOtpVerifyFails = new Map());

// Memoized Redis client — a fresh `new Redis()` per call is wasteful.
let redisClientPromise: Promise<import('@upstash/redis').Redis> | null = null;
function getRedisClient() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redisClientPromise ??= import('@upstash/redis').then(({ Redis }) =>
      new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      }),
    );
    return redisClientPromise;
  }
  // Fail closed in production: the in-memory store/lockout is per-instance and
  // an attacker could spread OTP guesses across instances to defeat the
  // verify-fail lockout. Refuse rather than silently degrade.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('OTP storage requires UPSTASH_REDIS_REST_URL/TOKEN in production');
  }
  return null;
}

function storeKey(scope: OtpScope, subject: string): string {
  return `${scope}:${subject}`;
}

function redisKey(scope: OtpScope, subject: string): string {
  return `otp:${scope}:${subject}`;
}

function sendRedisKey(scope: OtpScope, subject: string): string {
  return `otpsend:${scope}:${subject}`;
}

function verifyFailRedisKey(scope: OtpScope, subject: string): string {
  return `otpfail:${scope}:${subject}`;
}

/**
 * Generate a 6-digit OTP code.
 */
export function generateOTP(): string {
  return String(randomInt(100000, 999999));
}

/** Fixed-window counter shared by send-limit and verify-lockout logic. */
async function incrWindow(
  redisKeyName: string,
  memoryMap: Map<string, { count: number; windowStart: number }>,
  memoryKey: string,
  windowMs: number,
): Promise<number> {
  const redis = getRedisClient();
  if (redis) {
    const client = await redis;
    const n = await client.incr(redisKeyName);
    if (n === 1) {
      await client.expire(redisKeyName, Math.ceil(windowMs / 1000));
    }
    return n;
  }
  const now = Date.now();
  const entry = memoryMap.get(memoryKey);
  if (!entry || now - entry.windowStart >= windowMs) {
    memoryMap.set(memoryKey, { count: 1, windowStart: now });
    return 1;
  }
  entry.count++;
  return entry.count;
}

/**
 * Store an OTP code under a (scope, subject) key. Returns false if rate-limited.
 *
 * Scopes have independent rate-limit and attempt buckets — a staff send does
 * not count against the member's send budget for the same person. The send
 * counter is Redis-backed when configured, so the limit holds across serverless
 * instances rather than per-instance.
 */
export async function storeOTP(scope: OtpScope, subject: string, code: string): Promise<boolean> {
  const sends = await incrWindow(sendRedisKey(scope, subject), sendTrackers, trackerKey(scope, subject), SEND_WINDOW_MS);
  if (sends > MAX_SENDS_PER_WINDOW) {
    return false;
  }

  const entry: StoredOTP = {
    code,
    attempts: 0,
    expiresAt: Date.now() + OTP_TTL_MS,
  };

  const redis = getRedisClient();
  if (redis) {
    const client = await redis;
    await client.set(redisKey(scope, subject), JSON.stringify(entry), { ex: Math.ceil(OTP_TTL_MS / 1000) });
  }
  else {
    memoryStore.set(storeKey(scope, subject), entry);
  }

  return true;
}

function trackerKey(scope: OtpScope, subject: string): string {
  return `send:${scope}:${subject}`;
}

interface VerifyOTPResult {
  verified: boolean;
  reason?: 'not_found' | 'expired' | 'exhausted' | 'wrong_code';
  attemptsRemaining?: number;
}

/** Constant-time equality for equal-length codes. */
function codesMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Verify an OTP code for a (scope, subject) pair.
 * Returns { verified: true } on match, otherwise a reason and remaining attempts.
 */
export async function verifyOTP(scope: OtpScope, subject: string, code: string): Promise<VerifyOTPResult> {
  // Verify-side lockout — checked first and incremented on every failure below,
  // on a key independent of the OTP entry so re-sending a code can't reset it.
  const failCount = await peekVerifyFailures(scope, subject);
  if (failCount >= MAX_VERIFY_FAILURES) {
    return { verified: false, reason: 'exhausted', attemptsRemaining: 0 };
  }

  const redis = getRedisClient();
  let entry: StoredOTP | undefined;

  if (redis) {
    const client = await redis;
    const raw = await client.get<string>(redisKey(scope, subject));
    if (raw) {
      try {
        entry = (typeof raw === 'string' ? JSON.parse(raw) : raw) as StoredOTP;
      }
      catch {
        // Corrupt/legacy value — treat as absent rather than 500.
        entry = undefined;
      }
    }
  }
  else {
    entry = memoryStore.get(storeKey(scope, subject));
  }

  if (!entry) {
    return { verified: false, reason: 'not_found' };
  }

  if (Date.now() > entry.expiresAt) {
    await clearOtp(scope, subject);
    return { verified: false, reason: 'expired' };
  }

  if (entry.attempts >= MAX_ATTEMPTS) {
    return { verified: false, reason: 'exhausted', attemptsRemaining: 0 };
  }

  entry.attempts++;

  if (codesMatch(entry.code, code)) {
    await clearOtp(scope, subject);
    return { verified: true };
  }

  // Wrong code — bump both the per-code counter and the durable verify-fail
  // counter, then persist the updated attempt count.
  await incrWindow(verifyFailRedisKey(scope, subject), verifyFails, storeKey(scope, subject), VERIFY_FAIL_WINDOW_MS);

  if (redis) {
    const client = await redis;
    const remainingTtl = Math.ceil((entry.expiresAt - Date.now()) / 1000);
    if (remainingTtl > 0) {
      await client.set(redisKey(scope, subject), JSON.stringify(entry), { ex: remainingTtl });
    }
  }
  else {
    memoryStore.set(storeKey(scope, subject), entry);
  }

  const attemptsRemaining = Math.max(0, MAX_ATTEMPTS - entry.attempts);
  return {
    verified: false,
    reason: attemptsRemaining === 0 ? 'exhausted' : 'wrong_code',
    attemptsRemaining,
  };
}

async function clearOtp(scope: OtpScope, subject: string): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    const client = await redis;
    await client.del(redisKey(scope, subject));
  }
  else {
    memoryStore.delete(storeKey(scope, subject));
  }
}

/** Read the current verify-failure count without incrementing it. */
async function peekVerifyFailures(scope: OtpScope, subject: string): Promise<number> {
  const redis = getRedisClient();
  if (redis) {
    const client = await redis;
    const n = await client.get<number>(verifyFailRedisKey(scope, subject));
    return typeof n === 'number' ? n : Number(n ?? 0);
  }
  const entry = verifyFails.get(storeKey(scope, subject));
  if (!entry || Date.now() - entry.windowStart >= VERIFY_FAIL_WINDOW_MS) {
    return 0;
  }
  return entry.count;
}
