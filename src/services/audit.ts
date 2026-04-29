/**
 * Shared audit logging functionality for kiosk operations
 * Client-side service that sends audit data to API routes
 */

// Basic audit types for now - we'll improve these later
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

export class KioskAuditService {
  private static instance: KioskAuditService;

  static getInstance(): KioskAuditService {
    if (!KioskAuditService.instance) {
      KioskAuditService.instance = new KioskAuditService();
    }
    return KioskAuditService.instance;
  }

  /**
   * Log a kiosk audit event - sends to API route for server-side processing
   */
  async log(
    entity: AuditableEntity,
    entityId: string,
    action: AuditAction,
    context: KioskAuditContext,
    details?: Record<string, any>,
  ) {
    try {
      const auditEntry = {
        entity,
        entityId,
        action,
        userId: context.memberId || 'kiosk-user',
        metadata: {
          ...details,
          source: 'kiosk',
          kioskId: context.kioskId,
          sessionId: context.sessionId,
          userAgent: context.userAgent || (typeof window !== 'undefined' ? window.navigator.userAgent : undefined),
          ipAddress: context.ipAddress,
          phoneNumber: context.phoneNumber,
        },
        timestamp: new Date().toISOString(),
      };

      // For development, just log to console
      // TODO: Send to API route for proper database logging
      // Strip CR/LF from the serialized audit entry to prevent log injection.
      const safeEntry = JSON.stringify(auditEntry, null, 2).replace(/[\r\n]+/g, ' ');
      console.warn('Kiosk Audit:', safeEntry);

      // In production, this would be:
      // await fetch('/api/audit', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(auditEntry)
      // });
    }
    catch (error) {
      console.error('Kiosk audit logging failed:', error);
      // Don't throw - audit logging should not break user flows
    }
  }

  /**
   * Log member check-in
   */
  async logCheckin(memberId: string, context: KioskAuditContext) {
    await this.log('member', memberId, 'update', context, {
      action: 'checkin',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Log trial signup
   */
  async logTrialSignup(trialData: any, context: KioskAuditContext) {
    await this.log('member', trialData.id, 'create', context, {
      action: 'trial_signup',
      programId: trialData.programId,
      email: trialData.email,
    });
  }

  /**
   * Log membership signup
   */
  async logMembershipSignup(memberData: any, membershipData: any, context: KioskAuditContext) {
    await this.log('member', memberData.id, 'create', context, {
      action: 'membership_signup',
      membershipPlanId: membershipData.planId,
      paymentAmount: membershipData.amount,
      stripeSubscriptionId: membershipData.subscriptionId,
    });
  }

  /**
   * Log session start/end
   */
  async logSession(action: 'start' | 'end' | 'timeout', context: KioskAuditContext) {
    await this.log('system', context.sessionId, 'update', context, {
      action: `session_${action}`,
      timestamp: new Date().toISOString(),
    });
  }
}
