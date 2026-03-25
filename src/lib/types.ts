// Shared types for the kiosk application
// These are kiosk-specific utilities along with some basic shared functions
// TODO: Eventually import from main Dojo Planner application once path issues are resolved

// Basic auth types (simplified for kiosk use)
export type ORG_ROLE = 'OWNER' | 'ADMIN' | 'STAFF' | 'MEMBER';

// Basic audit types (simplified for kiosk use)
export type AuditableEntity = 'member' | 'system' | 'payment' | 'subscription';
export type AuditAction = 'create' | 'update' | 'delete' | 'login' | 'logout' | 'check-in' | 'trial-signup' | 'membership-signup';

export interface AuditLog {
  id: string;
  entity: AuditableEntity;
  entityId: string;
  action: AuditAction;
  userId: string;
  metadata?: Record<string, any>;
  timestamp: Date;
}

// Member types for kiosk operations (kiosk-compatible interface)
export interface Member {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string; // Kiosk uses phoneNumber, main app uses phone
  status: 'active' | 'inactive' | 'trial' | 'suspended';
  joinedAt: Date;
  lastCheckIn?: Date;
}

// Program types for trials
export interface Program {
  id: string;
  name: string;
  description: string;
  trialLength?: number; // days
  price: number;
  isActive: boolean;
}

// Membership plan types
export interface MembershipPlan {
  id: string;
  name: string;
  description: string;
  price: number;
  interval: 'monthly' | 'yearly';
  trialPeriodDays?: number;
  isActive: boolean;
}
