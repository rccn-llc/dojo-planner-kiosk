// XState machine types for kiosk user flows
import type { Member, MembershipPlan, Program } from '../lib/types';

// Member check-in machine context
export interface CheckinMember {
  memberId: string;
  firstName: string;
  lastName: string;
  status: string;
}

export interface CheckinClass {
  scheduleId: string;
  classId: string;
  className: string;
  startTime: string;
  endTime: string;
  room: string | null;
}

export interface CheckinContext {
  phoneNumber: string;
  members: CheckinMember[];
  selectedMember: CheckinMember | null;
  classes: CheckinClass[];
  selectedClass: CheckinClass | null;
  sessionId: string;
  errors: Record<string, string>;
}

// Trial signup machine context
export interface TrialContext {
  // Age group selection
  ageGroup: 'adult' | 'youth' | null;

  // Adult contact info
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  dateOfBirth: string;

  // Adult address
  address: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;

  // Youth - Parent/Guardian info
  parentFirstName: string;
  parentLastName: string;
  parentEmail: string;
  parentPhone: string;
  parentAddress: string;
  parentAddressLine2: string;
  parentCity: string;
  parentState: string;
  parentZip: string;
  parentDateOfBirth: string;

  // Youth - current child being entered
  currentChildFirstName: string;
  currentChildLastName: string;
  currentChildDateOfBirth: string;

  // Youth - all children confirmed so far
  children: Array<{ firstName: string; lastName: string; dateOfBirth: string }>;

  // Whether we are adding a subsequent child
  isAddingAdditionalChild: boolean;

  // Program selection
  selectedProgram: Program | null;
  availablePrograms: Program[];
  selectedMembershipPlanId: string;

  // Waiver
  waiverAgreed: boolean;
  signature: string;
  waiverTemplateId: string;
  waiverTemplateVersion: number;
  waiverContent: string;
  isLoadingWaiver: boolean;

  // Result
  memberId: string;

  // Form validation and state
  errors: Record<string, string>;
  isSubmitting: boolean;
  sessionId: string;
}

// Membership signup machine context
export interface MembershipContext {
  // Program + plan selection
  isLoadingPrograms: boolean;
  selectedProgram: Program | null;
  programs: Program[];
  plansByProgram: Record<string, MembershipPlan[]>;
  selectedPlan: MembershipPlan | null;
  availablePlans: MembershipPlan[];

  // Contact info
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  dateOfBirth: string; // YYYY-MM-DD

  // Guardian (required if member is under 18)
  guardianFirstName: string;
  guardianLastName: string;
  guardianEmail: string;
  guardianRelationship: string; // 'parent' | 'guardian' | 'legal_guardian'

  // Address
  address: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;

  // Commitment / waiver screen
  hasAgreedToCommitment: boolean;
  waiverSignature: string;
  waiverContent: string;
  waiverTemplateName: string;
  isLoadingWaiver: boolean;

  // Member lookup
  memberLookupPhone: string;
  memberLookupResult: Member | null;
  // If converting a trial membership, this holds the trial member_membership ID to cancel on success
  convertingTrialMembershipId: string | null;
  // The existing member's ID (if the lookup matched) — used to skip member creation
  existingMemberId: string | null;

  // Payment
  paymentMethod: 'card' | 'ach';
  cardholderName: string;
  cardToken: string;
  cardFirstSix: string;
  cardLastFour: string;
  cardExpiry: string;
  achAccountHolder: string;
  achRoutingNumber: string;
  achAccountNumber: string;
  achAccountType: 'Checking' | 'Savings';

  // Form validation and state
  errors: Record<string, string>;
  isSubmitting: boolean;
  sessionId: string;
}

// Event types
export type CheckinEvent
  = | { type: 'ENTER_PHONE'; phoneNumber: string }
    | { type: 'MEMBERS_FOUND'; members: CheckinMember[] }
    | { type: 'NO_ACTIVE_MEMBERSHIP'; message: string }
    | { type: 'MEMBER_NOT_FOUND' }
    | { type: 'SELECT_MEMBER'; member: CheckinMember }
    | { type: 'CLASSES_LOADED'; classes: CheckinClass[] }
    | { type: 'SELECT_CLASS'; classItem: CheckinClass }
    | { type: 'CHECKIN_SUCCESS' }
    | { type: 'CHECKIN_FAILED'; error?: string }
    | { type: 'TRY_AGAIN' }
    | { type: 'BACK' }
    | { type: 'RESET' };
export type TrialEvent
  = | { type: 'SELECT_AGE_GROUP'; ageGroup: 'adult' | 'youth' }
    | { type: 'UPDATE_FIELD'; field: string; value: string }
    | { type: 'SELECT_PROGRAM'; program: Program }
    | { type: 'SUBMIT_CONTACT' }
    | { type: 'SUBMIT_YOUTH_PARENT' }
    | { type: 'SUBMIT_YOUTH_CHILD' }
    | { type: 'ADD_ANOTHER_CHILD' }
    | { type: 'FINISH_YOUTH' }
    | { type: 'SUBMIT_WAIVER' }
    | { type: 'AGREE_WAIVER'; agreed: boolean }
    | { type: 'PROGRAMS_LOADED'; selectedMembershipPlanId: string }
    | { type: 'WAIVER_LOADED'; id: string; version: number; content: string }
    | { type: 'WAIVER_FAILED' }
    | { type: 'TRIAL_SUCCESS'; memberId: string }
    | { type: 'TRIAL_FAILED'; error: string }
    | { type: 'TRY_AGAIN' }
    | { type: 'BACK' }
    | { type: 'TIMEOUT' }
    | { type: 'RESET' };

export type MembershipEvent
  = | { type: 'UPDATE_FIELD'; field: string; value: string | boolean }
    | { type: 'SELECT_PROGRAM'; program: Program }
    | { type: 'SELECT_PLAN'; plan: MembershipPlan }
    | { type: 'PROGRAMS_LOADED'; programs: Program[]; plansByProgram: Record<string, MembershipPlan[]> }
    | { type: 'PROGRAMS_FAILED' }
    | { type: 'WAIVER_LOADED'; content: string; templateName: string }
    | { type: 'WAIVER_FAILED' }
    | { type: 'SUBMIT_CONTACT' }
    | { type: 'SUBMIT_PAYMENT' }
    | { type: 'SUBMIT_COMMITMENT' }
    | { type: 'LOOKUP_MEMBER' }
    | {
      type: 'MEMBER_FOUND';
      member: Member & {
        dateOfBirth?: string;
        address?: string;
        city?: string;
        state?: string;
        zip?: string;
        trialMembershipId?: string | null;
        existingSignature?: string;
      };
    }
    | { type: 'MEMBER_NOT_FOUND' }
    | { type: 'PAYMENT_SUCCESS' }
    | { type: 'PAYMENT_FAILED'; error?: string }
    | { type: 'TRY_AGAIN' }
    | { type: 'BACK' }
    | { type: 'TIMEOUT' }
    | { type: 'RESET' };

// ── Store types ───────────────────────────────────────────────────────────────

export interface StoreProduct {
  id: string;
  name: string;
  description: string;
  images: string[]; // URLs, primary first
  variants?: Array<{ id: string; name: string; price: number }>;
  basePrice: number;
  priceRange?: { min: number; max: number };
}

export interface CartItem {
  productId: string;
  productName: string;
  variantId?: string;
  variantName?: string;
  price: number;
  quantity: number;
}

export interface StoreContext {
  products: StoreProduct[];
  isLoadingProducts: boolean;
  selectedProduct: StoreProduct | null;
  selectedVariantId: string;
  selectedQuantity: number;
  cartItems: CartItem[];
  discountCode: string;
  discountAmount: number;
  adminFeeRate: number; // 0.0475 (4.75%)
  // Checkout buyer details
  memberSearchPhone: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  country: string;
  address: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
  hasSalesAgreement: boolean;
  // Payment method
  paymentMethod: 'card' | 'ach';
  // Card fields (populated after TokenEx tokenization)
  cardholderName: string;
  cardToken: string;
  cardFirstSix: string;
  cardLastFour: string;
  cardExpiry: string;
  // ACH fields
  achAccountHolder: string;
  achRoutingNumber: string;
  achAccountNumber: string;
  achAccountType: 'Checking' | 'Savings';
  errors: Record<string, string>;
  isSubmitting: boolean;
  sessionId: string;
}

export type StoreEvent
  = | { type: 'LOAD_PRODUCTS_SUCCESS'; products: StoreProduct[] }
    | { type: 'LOAD_PRODUCTS_FAILURE' }
    | { type: 'VIEW_PRODUCT'; product: StoreProduct }
    | { type: 'BACK_TO_BROWSE' }
    | { type: 'SELECT_VARIANT'; variantId: string }
    | { type: 'UPDATE_QUANTITY'; quantity: number }
    | { type: 'ADD_TO_CART' }
    | { type: 'VIEW_CART' }
    | { type: 'REMOVE_ITEM'; productId: string; variantId?: string }
    | { type: 'APPLY_DISCOUNT' }
    | { type: 'DISCOUNT_APPLIED'; discountAmount: number }
    | { type: 'DISCOUNT_FAILED'; error: string }
    | { type: 'PROCEED_TO_CHECKOUT' }
    | { type: 'BACK_TO_CART' }
    | { type: 'LOOKUP_MEMBER' }
    | { type: 'MEMBER_FOUND'; firstName: string; lastName: string; email: string; phone: string }
    | { type: 'MEMBER_NOT_FOUND' }
    | { type: 'UPDATE_FIELD'; field: string; value: string | boolean }
    | { type: 'PLACE_ORDER' }
    | { type: 'PAYMENT_SUCCESS' }
    | { type: 'PAYMENT_FAILED'; error?: string }
    | { type: 'TRY_AGAIN' }
    | { type: 'RESET' }
    | { type: 'TIMEOUT' };
