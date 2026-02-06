// Shared types for the kiosk application
// These will eventually import from the main Dojo Planner application once path issues are resolved

// Basic auth types
export type ORG_ROLE = 'OWNER' | 'ADMIN' | 'STAFF' | 'MEMBER';

// Basic audit types
export type AuditableEntity = 'member' | 'system' | 'payment' | 'subscription';
export type AuditAction = 'create' | 'update' | 'delete' | 'login' | 'logout';

export interface AuditLog {
  id: string;
  entity: AuditableEntity;
  entityId: string;
  action: AuditAction;
  userId: string;
  metadata?: Record<string, any>;
  timestamp: Date;
}

// Member types for kiosk operations
export interface Member {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
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
