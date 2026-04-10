import { randomInt } from 'node:crypto';

interface StoredOTP {
  code: string;
  attempts: number;
  expiresAt: number;
}

// Rate-limit tracking: max 3 OTP sends per member per 10 min
interface SendTracker {
  count: number;
  windowStart: number;
}

const SEND_WINDOW_MS = 10 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3;
const MAX_ATTEMPTS = 3;
const OTP_TTL_MS = 5 * 60 * 1000;

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

/**
 * Generate a 6-digit OTP code.
 */
export function generateOTP(): string {
  return String(randomInt(100000, 999999));
}

/**
 * Store an OTP code for a member. Returns false if rate-limited.
 */
export async function storeOTP(memberId: string, code: string): Promise<boolean> {
  // Check rate limit
  const now = Date.now();
  const trackerKey = `send:${memberId}`;
  const tracker = sendTrackers.get(trackerKey);

  if (tracker) {
    if (now - tracker.windowStart < SEND_WINDOW_MS) {
      if (tracker.count >= MAX_SENDS_PER_WINDOW) {
        return false;
      }
      tracker.count++;
    }
    else {
      sendTrackers.set(trackerKey, { count: 1, windowStart: now });
    }
  }
  else {
    sendTrackers.set(trackerKey, { count: 1, windowStart: now });
  }

  const entry: StoredOTP = {
    code,
    attempts: 0,
    expiresAt: now + OTP_TTL_MS,
  };

  const redis = getRedisClient();
  if (redis) {
    const client = await redis;
    const key = `otp:${memberId}`;
    await client.set(key, JSON.stringify(entry), { ex: Math.ceil(OTP_TTL_MS / 1000) });
  }
  else {
    memoryStore.set(memberId, entry);
  }

  return true;
}

interface VerifyOTPResult {
  verified: boolean;
  reason?: 'not_found' | 'expired' | 'exhausted' | 'wrong_code';
  attemptsRemaining?: number;
}

/**
 * Verify an OTP code for a member.
 * Returns { verified: true } on match, otherwise a reason and remaining attempts.
 */
export async function verifyOTP(memberId: string, code: string): Promise<VerifyOTPResult> {
  const redis = getRedisClient();
  let entry: StoredOTP | undefined;

  if (redis) {
    const client = await redis;
    const key = `otp:${memberId}`;
    const raw = await client.get<string>(key);
    if (raw) {
      entry = (typeof raw === 'string' ? JSON.parse(raw) : raw) as StoredOTP;
    }
  }
  else {
    entry = memoryStore.get(memberId);
  }

  if (!entry) {
    return { verified: false, reason: 'not_found' };
  }

  if (Date.now() > entry.expiresAt) {
    // Expired — clean up
    if (redis) {
      const client = await redis;
      await client.del(`otp:${memberId}`);
    }
    else {
      memoryStore.delete(memberId);
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
      await client.del(`otp:${memberId}`);
    }
    else {
      memoryStore.delete(memberId);
    }
    return { verified: true };
  }

  // Wrong code — update attempt count
  if (redis) {
    const client = await redis;
    const remainingTtl = Math.ceil((entry.expiresAt - Date.now()) / 1000);
    if (remainingTtl > 0) {
      await client.set(`otp:${memberId}`, JSON.stringify(entry), { ex: remainingTtl });
    }
  }
  else {
    memoryStore.set(memberId, entry);
  }

  const attemptsRemaining = Math.max(0, MAX_ATTEMPTS - entry.attempts);
  return {
    verified: false,
    reason: attemptsRemaining === 0 ? 'exhausted' : 'wrong_code',
    attemptsRemaining,
  };
}
