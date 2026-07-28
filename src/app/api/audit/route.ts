import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { resolveOrgIdFromRequest } from '@/lib/clerk';
import { getDatabase } from '@/lib/database';
import { auditEvent } from '@/lib/memberSchema';
import { clientIp, rateLimit } from '@/lib/rateLimit';

// Audit events originate in client-side XState machines on the public kiosk, so
// every field is untrusted. We persist only a small allowlist of operational
// events and NEVER store client-claimed PII (name / email / phone) in the audit
// row — the raw-PII-in-console behavior this route replaces was the problem.
// Org, IP, user-agent, and timestamp are all derived server-side.

const ALLOWED_ENTITIES = new Set(['payment', 'member', 'system', 'subscription']);
const ALLOWED_ACTIONS = new Set(['create', 'update', 'delete', 'login', 'logout']);

interface AuditBody {
  entity?: string;
  entityId?: string;
  action?: string;
  sessionId?: string;
  // Non-PII operational metadata only. Anything PII-shaped is dropped below.
  metadata?: Record<string, unknown>;
}

// Keys we will persist from client metadata. Deliberately excludes firstName,
// lastName, email, phoneNumber, and anything else that could be PII.
const SAFE_METADATA_KEYS = new Set([
  'action',
  'itemCount',
  'subtotal',
  'programId',
  'membershipPlanId',
  'paymentAmount',
]);

function pickSafeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!metadata) {
    return out;
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (!SAFE_METADATA_KEYS.has(key)) {
      continue;
    }
    // Only keep primitive, non-object values so a nested PII blob can't ride in.
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

export async function POST(request: Request) {
  try {
    const orgId = await resolveOrgIdFromRequest(request) ?? process.env.ORGANIZATION_ID ?? null;
    if (!orgId) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 400 });
    }

    // Rate-limit per IP: unauthenticated write endpoint on a public terminal.
    const allowed = await rateLimit(`audit:${clientIp(request)}`, 60, 60 * 1000);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await request.json() as AuditBody;

    const entity = body.entity?.trim() ?? '';
    const action = body.action?.trim() ?? '';
    if (!ALLOWED_ENTITIES.has(entity) || !ALLOWED_ACTIONS.has(action)) {
      return NextResponse.json({ error: 'Invalid audit event' }, { status: 400 });
    }

    const safeMetadata = pickSafeMetadata(body.metadata);
    // Keep a session correlation id (kiosk-generated, not PII) if present.
    if (typeof body.sessionId === 'string' && body.sessionId) {
      safeMetadata.sessionId = body.sessionId.slice(0, 128);
    }

    const db = getDatabase();
    await db.insert(auditEvent).values({
      id: randomUUID(),
      organizationId: orgId,
      userId: 'kiosk-user',
      action,
      entityType: entity,
      entityId: typeof body.entityId === 'string' ? body.entityId.slice(0, 255) : null,
      role: 'kiosk',
      status: 'success',
      changes: Object.keys(safeMetadata).length > 0 ? JSON.stringify(safeMetadata) : null,
      // Server-derived — never trusted from the client.
      ipAddress: clientIp(request).slice(0, 64),
      userAgent: (request.headers.get('user-agent') ?? '').slice(0, 512) || null,
      timestamp: new Date(),
    });

    return NextResponse.json({ logged: true });
  }
  catch (error) {
    // Audit logging must never break a user flow; log server-side and return ok.
    console.error('[api/audit] Error:', error);
    return NextResponse.json({ logged: false }, { status: 200 });
  }
}
