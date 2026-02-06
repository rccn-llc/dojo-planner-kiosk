// XState machine types for kiosk user flows
import type { Member, MembershipPlan, Program } from '../shared/types';

// Member check-in machine context
export interface CheckinContext {
  phoneNumber: string;
  member: Member | null;
  sessionId: string;
  errors: Record<string, string>;
}

// Trial signup machine context
export interface TrialContext {
  // Contact info
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;

  // Program selection
  selectedProgram: Program | null;
  availablePrograms: Program[];

  // Form validation and state
  errors: Record<string, string>;
  isSubmitting: boolean;
  sessionId: string;
}

// Membership signup machine context
export interface MembershipContext {
  // Contact info
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;

  // Membership selection
  selectedPlan: MembershipPlan | null;
  availablePlans: MembershipPlan[];

  // Payment info
  paymentMethodId: string;
  customerId: string;
  subscriptionId: string;

  // Form validation and state
  errors: Record<string, string>;
  isSubmitting: boolean;
  sessionId: string;
}

// Event types
export type CheckinEvent
  = | { type: 'ENTER_PHONE'; phoneNumber: string }
    | { type: 'INVALID_PHONE' }
    | { type: 'CONFIRM_CHECKIN' }
    | { type: 'CONTINUE_TO_UPGRADE' }
    | { type: 'SELECT_PROGRAM'; program: Program }
    | { type: 'SELECT_PLAN'; plan: MembershipPlan }
    | { type: 'CONTINUE' }
    | { type: 'UPDATE_INFO'; firstName?: string; lastName?: string; email?: string; phoneNumber?: string }
    | { type: 'SUBMIT_UPGRADE' }
    | { type: 'SKIP_UPGRADE' }
    | { type: 'BACK' };
export type TrialEvent
  = | { type: 'UPDATE_FIELD'; field: string; value: string }
    | { type: 'SELECT_PROGRAM'; program: Program }
    | { type: 'SUBMIT_CONTACT' }
    | { type: 'SUBMIT_TRIAL' }
    | { type: 'TRY_AGAIN' }
    | { type: 'TIMEOUT' }
    | { type: 'RESET' };

export type MembershipEvent
  = | { type: 'UPDATE_FIELD'; field: string; value: string }
    | { type: 'SELECT_PLAN'; plan: MembershipPlan }
    | { type: 'SUBMIT_CONTACT' }
    | { type: 'SUBMIT_PAYMENT' }
    | { type: 'PAYMENT_FAILED'; error?: string }
    | { type: 'TRY_AGAIN' }
    | { type: 'TIMEOUT' }
    | { type: 'RESET' };

// Member Area types
export interface MemberAreaContext {
  selectedProgram: Program | null;
  selectedPlan: MembershipPlan | null;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  password: string;
  sessionId: string;
  errors: Record<string, string>;
  isSubmitting: boolean;
}

export type MemberAreaEvent
  = | { type: 'SELECT_PROGRAM'; program: Program }
    | { type: 'SELECT_PLAN'; plan: MembershipPlan }
    | { type: 'CONTINUE' }
    | { type: 'UPDATE_INFO'; firstName?: string; lastName?: string; email?: string; phoneNumber?: string; password?: string }
    | { type: 'SUBMIT' }
    | { type: 'INVALID_INFO' }
    | { type: 'BACK' }
    | { type: 'RESET' };
