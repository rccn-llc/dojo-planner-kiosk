import { eq } from 'drizzle-orm';
import speakeasy from 'speakeasy';
import { getDatabase } from '@/lib/database';
import { organization } from '@/lib/memberSchema';

// In-memory cache for TOTP secrets
const secretCache = new Map<string, { secret: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getTotpSecret(orgId: string): Promise<string | null> {
  // Check env var first
  const envSecret = process.env.STAFF_TOTP_SECRET;
  if (envSecret) {
    return envSecret;
  }

  // Check cache
  const cached = secretCache.get(orgId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.secret;
  }

  // Look up in database
  const db = getDatabase();
  const rows = await db
    .select({ staffTotpSecret: organization.staffTotpSecret })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  const secret = rows[0]?.staffTotpSecret ?? null;
  if (secret) {
    secretCache.set(orgId, { secret, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  return secret;
}

/**
 * Verify a TOTP code for staff access to the kiosk member management area.
 */
export async function verifyStaffTOTP(code: string, orgId: string): Promise<boolean> {
  const secret = await getTotpSecret(orgId);
  if (!secret) {
    return false;
  }

  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: code,
    window: 1,
  });
}

/**
 * Check whether staff TOTP is configured for the given organization.
 */
export async function isStaffTOTPConfigured(orgId: string): Promise<boolean> {
  const secret = await getTotpSecret(orgId);
  return !!secret;
}
