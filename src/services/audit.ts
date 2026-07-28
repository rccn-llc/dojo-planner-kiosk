/**
 * Shared audit logging for kiosk operations.
 *
 * Client-side service that POSTs audit events to /api/audit for server-side
 * persistence in the shared audit_event table. The server derives org, IP,
 * user-agent, and timestamp itself and stores only a non-PII allowlist — the
 * client is untrusted, so we never send (and the server never stores) raw
 * customer name / email / phone. This replaced an earlier stub that logged the
 * full order — PII included — to the public terminal's browser console.
 */

type AuditableEntity = 'member' | 'system' | 'payment' | 'subscription';
type AuditAction = 'create' | 'update' | 'delete' | 'login' | 'logout';

interface KioskAuditContext {
  kioskId?: string;
  sessionId: string;
  userAgent?: string;
  ipAddress?: string;
  memberId?: string;
  phoneNumber?: string;
}

const RESERVED_FIRST_SEGMENTS = new Set(['api', '_next', 'favicon.ico']);

/**
 * Resolve the org slug the same way useOrgSlug does: first path segment, then
 * ?org=, then the build-time default. Returns null when nothing is available.
 */
function resolveOrgSlug(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const first = window.location.pathname.split('/').filter(Boolean)[0];
  if (first && !RESERVED_FIRST_SEGMENTS.has(first)) {
    return first;
  }
  const query = new URLSearchParams(window.location.search).get('org')?.trim();
  if (query) {
    return query;
  }
  return process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ?? null;
}

export class KioskAuditService {
  private static instance: KioskAuditService;

  static getInstance(): KioskAuditService {
    if (!KioskAuditService.instance) {
      KioskAuditService.instance = new KioskAuditService();
    }
    return KioskAuditService.instance;
  }

  /**
   * Log a kiosk audit event by POSTing to /api/audit.
   *
   * Only non-PII operational fields in `details` are forwarded (the server
   * further filters to an allowlist). Never pass raw name / email / phone in
   * `details` — they will be dropped, but keeping them out client-side avoids
   * ever putting PII on the wire from the public terminal.
   */
  async log(
    entity: AuditableEntity,
    entityId: string,
    action: AuditAction,
    context: KioskAuditContext,
    details?: Record<string, unknown>,
  ) {
    try {
      const slug = resolveOrgSlug();
      const path = slug ? `/api/audit?org=${encodeURIComponent(slug)}` : '/api/audit';

      await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity,
          entityId,
          action,
          sessionId: context.sessionId,
          metadata: details ?? {},
        }),
        keepalive: true,
      });
    }
    catch (error) {
      // Audit logging must never break a user flow.
      console.error('Kiosk audit logging failed:', error);
    }
  }

  /**
   * Log member check-in.
   */
  async logCheckin(memberId: string, context: KioskAuditContext) {
    await this.log('member', memberId, 'update', context, { action: 'checkin' });
  }

  /**
   * Log trial signup. Only non-PII fields are forwarded.
   */
  async logTrialSignup(trialData: { id: string; programId?: string }, context: KioskAuditContext) {
    await this.log('member', trialData.id, 'create', context, {
      action: 'trial_signup',
      programId: trialData.programId,
    });
  }

  /**
   * Log membership signup. Only non-PII fields are forwarded.
   */
  async logMembershipSignup(
    memberData: { id: string },
    membershipData: { planId?: string; amount?: number },
    context: KioskAuditContext,
  ) {
    await this.log('member', memberData.id, 'create', context, {
      action: 'membership_signup',
      membershipPlanId: membershipData.planId,
      paymentAmount: membershipData.amount,
    });
  }

  /**
   * Log session start/end/timeout.
   */
  async logSession(action: 'start' | 'end' | 'timeout', context: KioskAuditContext) {
    await this.log('system', context.sessionId, 'update', context, {
      action: `session_${action}`,
    });
  }
}
