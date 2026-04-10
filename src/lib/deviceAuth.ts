import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/database';
import { kioskDevice } from '@/lib/kioskSchema';

interface DeviceInfo {
  orgId: string;
  deviceId: string;
  deviceName: string;
}

// In-memory cache for device lookups (5-min TTL)
const deviceCache = new Map<string, { info: DeviceInfo; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

// Throttle lastSeenAt updates to once per minute per device
const lastSeenUpdates = new Map<string, number>();
const LAST_SEEN_THROTTLE_MS = 60 * 1000;

function normalizeFingerprint(raw: string): string {
  // Caddy sends fingerprints as colon-separated hex or URL-encoded —
  // normalize to lowercase hex without colons.
  return raw
    .replace(/%3A/gi, ':')
    .replace(/:/g, '')
    .toLowerCase();
}

async function lookupDevice(fingerprint: string): Promise<DeviceInfo | null> {
  const normalized = normalizeFingerprint(fingerprint);

  // Check cache
  const cached = deviceCache.get(normalized);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.info;
  }

  // Also try SHA-256 hash of the raw DER fingerprint for compatibility
  const sha256 = createHash('sha256').update(normalized).digest('hex');
  const candidates = [normalized, sha256];

  const db = getDatabase();

  for (const candidate of candidates) {
    const rows = await db
      .select()
      .from(kioskDevice)
      .where(eq(kioskDevice.certFingerprint, candidate))
      .limit(1);

    const row = rows[0];
    if (row && row.isActive) {
      const info: DeviceInfo = {
        orgId: row.organizationId,
        deviceId: row.id,
        deviceName: row.name,
      };
      deviceCache.set(normalized, { info, expiresAt: Date.now() + CACHE_TTL_MS });

      // Throttle lastSeenAt update
      const lastUpdate = lastSeenUpdates.get(row.id) ?? 0;
      if (Date.now() - lastUpdate > LAST_SEEN_THROTTLE_MS) {
        lastSeenUpdates.set(row.id, Date.now());
        db.update(kioskDevice)
          .set({ lastSeenAt: new Date() })
          .where(eq(kioskDevice.id, row.id))
          .then(() => {})
          .catch(() => {});
      }

      return info;
    }
  }

  return null;
}

/**
 * Validate an incoming kiosk request by checking mTLS headers set by Caddy.
 *
 * In development (NODE_ENV=development) returns a synthetic device for
 * the ORGANIZATION_ID configured in the environment.
 *
 * In production:
 *   1. Verifies x-proxy-secret matches PROXY_SECRET
 *   2. Checks x-client-cert-verified === 'true'
 *   3. Resolves device from x-client-cert-fingerprint against kiosk_device table
 */
export async function validateDevice(request: Request): Promise<DeviceInfo | null> {
  // Development bypass
  if (process.env.NODE_ENV === 'development') {
    const orgId = process.env.ORGANIZATION_ID;
    if (!orgId) {
      return null;
    }
    return { orgId, deviceId: 'dev-device', deviceName: 'Development' };
  }

  const headers = request.headers;

  // Verify proxy secret
  const proxySecret = process.env.PROXY_SECRET;
  if (proxySecret && headers.get('x-proxy-secret') !== proxySecret) {
    return null;
  }

  // Verify client cert was validated by Caddy
  if (headers.get('x-client-cert-verified') !== 'true') {
    return null;
  }

  // Look up device by cert fingerprint
  const fingerprint = headers.get('x-client-cert-fingerprint');
  if (!fingerprint) {
    return null;
  }

  return lookupDevice(fingerprint);
}
