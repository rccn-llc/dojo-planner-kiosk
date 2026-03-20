// XState machine types for kiosk user flows
import type { Member, MembershipPlan, Program } from '../shared/types';

// Member check-in machine context
export interface CheckinContext {
  phoneNumber: string;
  member: Member | null;
  sessionId: string;
  errors: Record<string, string>;
  upgradeFirstName?: string;
  upgradeLastName?: string;
  upgradeEmail?: string;
  upgradePhoneNumber?: string;
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

  // Adult address
  address: string;
  addressLine2: string;
  city: string;
  state: string;

  // Youth - Parent/Guardian info
  parentFirstName: string;
  parentLastName: string;
  parentEmail: string;
  parentPhone: string;
  parentAddress: string;
  parentAddressLine2: string;
  parentCity: string;
  parentState: string;

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

  // Waiver
  waiverAgreed: boolean;
  signature: string;

  // Form validation and state
  errors: Record<string, string>;
  isSubmitting: boolean;
  sessionId: string;
}

// Membership signup machine context
export interface MembershipContext {
  // Program + plan selection
  selectedProgram: Program | null;
  programs: Program[];
  selectedPlan: MembershipPlan | null;
  availablePlans: MembershipPlan[];

  // Contact info
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;

  // Address
  address: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;

  // Commitment screen
  hasAgreedToCommitment: boolean;

  // Member lookup
  memberLookupPhone: string;
  memberLookupResult: Member | null;

  // Form validation and state
  errors: Record<string, string>;
  isSubmitting: boolean;
  sessionId: string;
}

// Event types
export type CheckinEvent
  = | { type: 'ENTER_PHONE'; phoneNumber: string }
    | { type: 'TRY_AGAIN' }
    | { type: 'RESET' } | { type: 'GO_TO_TRIAL' } | { type: 'INVALID_PHONE' }
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
    | { type: 'TRY_AGAIN' }
    | { type: 'BACK' }
    | { type: 'TIMEOUT' }
    | { type: 'RESET' };

export type MembershipEvent
  = | { type: 'UPDATE_FIELD'; field: string; value: string | boolean }
    | { type: 'SELECT_PROGRAM'; program: Program }
    | { type: 'SELECT_PLAN'; plan: MembershipPlan }
    | { type: 'SUBMIT_CONTACT' }
    | { type: 'SUBMIT_PAYMENT' }
    | { type: 'SUBMIT_COMMITMENT' }
    | { type: 'LOOKUP_MEMBER' }
    | { type: 'PAYMENT_FAILED'; error?: string }
    | { type: 'TRY_AGAIN' }
    | { type: 'BACK' }
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
    | { type: 'PROCEED_TO_CHECKOUT' }
    | { type: 'BACK_TO_CART' }
    | { type: 'LOOKUP_MEMBER' }
    | { type: 'UPDATE_FIELD'; field: string; value: string | boolean }
    | { type: 'PLACE_ORDER' }
    | { type: 'PAYMENT_SUCCESS' }
    | { type: 'PAYMENT_FAILED'; error?: string }
    | { type: 'TRY_AGAIN' }
    | { type: 'RESET' }
    | { type: 'TIMEOUT' };
