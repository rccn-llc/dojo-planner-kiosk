import { randomInt } from 'node:crypto';

interface StoredOTP {
  code: string;
  attempts: number;
  expiresAt: number;
}

// Rate-limit tracking: max 3 OTP sends per (scope, subject) per 10 min
interface SendTracker {
  count: number;
  windowStart: number;
}

const SEND_WINDOW_MS = 10 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3;
const MAX_ATTEMPTS = 3;
const OTP_TTL_MS = 5 * 60 * 1000;

type OtpScope = 'member' | 'staff';

// In-memory store for development; Upstash Redis for production.
// Stash on globalThis so the store survives Next.js dev HMR and is shared
// across route handlers (each route is bundled independently, so a plain
// module-scoped const would create a separate Map per route handler).
interface OtpGlobals {
  __kioskOtpStore?: Map<string, StoredOTP>;
  __kioskOtpSendTrackers?: Map<string, SendTracker>;
}
const otpGlobals = globalThis as typeof globalThis & OtpGlobals;
const memoryStore: Map<string, StoredOTP>
  = otpGlobals.__kioskOtpStore ?? (otpGlobals.__kioskOtpStore = new Map<string, StoredOTP>());
const sendTrackers: Map<string, SendTracker>
  = otpGlobals.__kioskOtpSendTrackers ?? (otpGlobals.__kioskOtpSendTrackers = new Map<string, SendTracker>());

function getRedisClient() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    // Dynamic import to avoid bundling Upstash when not configured
    return import('@upstash/redis').then(({ Redis }) =>
      new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      }),
    );
  }
  return null;
}

function storeKey(scope: OtpScope, subject: string): string {
  return `${scope}:${subject}`;
}

function redisKey(scope: OtpScope, subject: string): string {
  return `otp:${scope}:${subject}`;
}

function trackerKey(scope: OtpScope, subject: string): string {
  return `send:${scope}:${subject}`;
}

/**
 * Generate a 6-digit OTP code.
 */
export function generateOTP(): string {
  return String(randomInt(100000, 999999));
}

/**
 * Store an OTP code under a (scope, subject) key. Returns false if rate-limited.
 *
 * Scopes have independent rate-limit and attempt buckets — a staff send does
 * not count against the member's send budget for the same person.
 */
export async function storeOTP(scope: OtpScope, subject: string, code: string): Promise<boolean> {
  const now = Date.now();
  const tKey = trackerKey(scope, subject);
  const tracker = sendTrackers.get(tKey);

  if (tracker) {
    if (now - tracker.windowStart < SEND_WINDOW_MS) {
      if (tracker.count >= MAX_SENDS_PER_WINDOW) {
        return false;
      }
      tracker.count++;
    }
    else {
      sendTrackers.set(tKey, { count: 1, windowStart: now });
    }
  }
  else {
    sendTrackers.set(tKey, { count: 1, windowStart: now });
  }

  const entry: StoredOTP = {
    code,
    attempts: 0,
    expiresAt: now + OTP_TTL_MS,
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

interface VerifyOTPResult {
  verified: boolean;
  reason?: 'not_found' | 'expired' | 'exhausted' | 'wrong_code';
  attemptsRemaining?: number;
}

/**
 * Verify an OTP code for a (scope, subject) pair.
 * Returns { verified: true } on match, otherwise a reason and remaining attempts.
 */
export async function verifyOTP(scope: OtpScope, subject: string, code: string): Promise<VerifyOTPResult> {
  const redis = getRedisClient();
  let entry: StoredOTP | undefined;

  if (redis) {
    const client = await redis;
    const raw = await client.get<string>(redisKey(scope, subject));
    if (raw) {
      entry = (typeof raw === 'string' ? JSON.parse(raw) : raw) as StoredOTP;
    }
  }
  else {
    entry = memoryStore.get(storeKey(scope, subject));
  }

  if (!entry) {
    return { verified: false, reason: 'not_found' };
  }

  if (Date.now() > entry.expiresAt) {
    // Expired — clean up
    if (redis) {
      const client = await redis;
      await client.del(redisKey(scope, subject));
    }
    else {
      memoryStore.delete(storeKey(scope, subject));
    }
    return { verified: false, reason: 'expired' };
  }

  if (entry.attempts >= MAX_ATTEMPTS) {
    return { verified: false, reason: 'exhausted', attemptsRemaining: 0 };
  }

  entry.attempts++;

  if (entry.code === code) {
    // Valid — remove the OTP
    if (redis) {
      const client = await redis;
      await client.del(redisKey(scope, subject));
    }
    else {
      memoryStore.delete(storeKey(scope, subject));
    }
    return { verified: true };
  }

  // Wrong code — update attempt count
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
