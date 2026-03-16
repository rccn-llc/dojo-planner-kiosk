import type { MembershipPlan, Program } from '../shared/types';
import type { MembershipContext, MembershipEvent } from './types';
import { assign, createMachine } from 'xstate';
import { KioskAuditService } from '../services/audit';
import { generateSessionId, isValidEmail, isValidPhoneNumber } from '../shared/utils';

// ── Hardcoded data ────────────────────────────────────────────────────────────

const PROGRAMS: Program[] = [
  {
    id: 'adult-bjj',
    name: 'Adult Brazilian Jiu Jitsu',
    description: 'Fundamentals through advanced techniques for all levels',
    price: 0,
    isActive: true,
  },
  {
    id: 'kids',
    name: 'Kids Program',
    description: 'Ages 4–12, discipline and character development through martial arts',
    price: 0,
    isActive: true,
  },
  {
    id: 'competition',
    name: 'Competition Team',
    description: 'Advanced training for tournament competitors',
    price: 0,
    isActive: true,
  },
  {
    id: 'judo',
    name: 'Judo Fundamentals',
    description: 'Traditional Judo throws, sweeps, and groundwork',
    price: 0,
    isActive: true,
  },
];

const PLANS_BY_PROGRAM: Record<string, MembershipPlan[]> = {
  'adult-bjj': [
    { id: 'abjj-1mo', name: '1 Month Enrollment', description: 'Month-to-month flexibility\n• Unlimited classes\n• Open mat access\n• No contract', price: 150, interval: 'monthly', isActive: true },
    { id: 'abjj-mth', name: 'Month-to-Month', description: 'Ongoing monthly membership\n• Unlimited classes\n• Open mat access\n• Cancel anytime', price: 170, interval: 'monthly', isActive: true },
    { id: 'abjj-6mo', name: '6 Month Enrollment', description: '6-month commitment, save 10%\n• Unlimited classes\n• Open mat access\n• Priority enrollment', price: 810, interval: 'yearly', isActive: true },
    { id: 'abjj-annual-fam', name: 'Annual Family', description: '12-month family plan\n• Up to 4 members\n• Unlimited classes\n• Best value', price: 1530, interval: 'yearly', isActive: true },
  ],
  'kids': [
    { id: 'kids-1mo', name: '1 Month Enrollment', description: 'Month-to-month\n• 2 classes/week\n• Character development\n• No contract', price: 110, interval: 'monthly', isActive: true },
    { id: 'kids-6mo', name: '6 Month Enrollment', description: '6-month commitment\n• 2 classes/week\n• Progress tracking\n• Belt testing included', price: 600, interval: 'yearly', isActive: true },
    { id: 'kids-annual', name: '12 Month Enrollment', description: 'Best value\n• 2 classes/week\n• Belt testing included\n• Gi included', price: 1080, interval: 'yearly', isActive: true },
  ],
  'competition': [
    { id: 'comp-1mo', name: '1 Month Enrollment', description: 'Monthly access\n• Competition training\n• Live drills\n• Film review', price: 200, interval: 'monthly', isActive: true },
    { id: 'comp-annual', name: '12 Month Enrollment', description: '12-month commitment\n• Full competition training\n• Tournament coaching\n• Best value', price: 2000, interval: 'yearly', isActive: true },
  ],
  'judo': [
    { id: 'judo-1mo', name: '1 Month Enrollment', description: 'Month-to-month\n• Unlimited classes\n• Traditional Judo\n• No contract', price: 120, interval: 'monthly', isActive: true },
    { id: 'judo-annual', name: '12 Month Enrollment', description: '12-month commitment\n• Unlimited classes\n• Belt testing included\n• Best value', price: 1200, interval: 'yearly', isActive: true },
  ],
};

// ── Validation ────────────────────────────────────────────────────────────────

function validateContactInfo(context: MembershipContext): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!context.firstName?.trim()) {
    errors.firstName = 'First name is required';
  }
  if (!context.lastName?.trim()) {
    errors.lastName = 'Last name is required';
  }
  if (!context.email?.trim()) {
    errors.email = 'Email is required';
  }
  else if (!isValidEmail(context.email)) {
    errors.email = 'Please enter a valid email';
  }
  if (!context.phoneNumber?.trim()) {
    errors.phoneNumber = 'Phone number is required';
  }
  else if (!isValidPhoneNumber(context.phoneNumber)) {
    errors.phoneNumber = 'Please enter a valid 10-digit phone number';
  }
  if (!context.address?.trim()) {
    errors.address = 'Address is required';
  }
  if (!context.city?.trim()) {
    errors.city = 'City is required';
  }
  if (!context.state?.trim()) {
    errors.state = 'State is required';
  }
  if (!context.zip?.trim()) {
    errors.zip = 'ZIP code is required';
  }
  return errors;
}

// ── Empty context ─────────────────────────────────────────────────────────────

const emptyContext: MembershipContext = {
  selectedProgram: null,
  programs: PROGRAMS,
  selectedPlan: null,
  availablePlans: [],
  firstName: '',
  lastName: '',
  email: '',
  phoneNumber: '',
  address: '',
  addressLine2: '',
  city: '',
  state: '',
  zip: '',
  hasAgreedToCommitment: false,
  memberLookupPhone: '',
  memberLookupResult: null,
  errors: {} as Record<string, string>,
  isSubmitting: false,
  sessionId: '',
};

// ── Guards ────────────────────────────────────────────────────────────────────

export const membershipGuards = {
  isContactInfoValid: ({ context }: { context: MembershipContext }) =>
    Object.keys(validateContactInfo(context)).length === 0,

  isPlanSelected: ({ context }: { context: MembershipContext }) =>
    !!context.selectedPlan,

  hasAgreedToCommitment: ({ context }: { context: MembershipContext }) =>
    !!context.hasAgreedToCommitment,
};

// ── Actions ───────────────────────────────────────────────────────────────────

export const membershipActions = {
  auditMembershipCreation: ({ context }: { context: MembershipContext }) => {
    if (context.selectedPlan && context.email) {
      const audit = KioskAuditService.getInstance();
      audit.logMembershipSignup(
        { id: `member_${Date.now()}`, email: context.email, firstName: context.firstName, lastName: context.lastName },
        { planId: context.selectedPlan.id, amount: context.selectedPlan.price, subscriptionId: `sub_${Date.now()}` },
        { sessionId: context.sessionId, phoneNumber: context.phoneNumber },
      );
    }
  },

  auditTimeout: ({ context }: { context: MembershipContext }) => {
    KioskAuditService.getInstance().logSession('timeout', {
      sessionId: context.sessionId,
      phoneNumber: context.phoneNumber,
    });
  },
};

// ── Machine ───────────────────────────────────────────────────────────────────

export const membershipMachine = createMachine({
  id: 'membership',
  types: {} as { context: MembershipContext; events: MembershipEvent },

  context: { ...emptyContext },

  initial: 'selectingProgram',

  states: {
    // ── Step 1: Program selection ─────────────────────────────────────────────
    selectingProgram: {
      entry: assign({ ...emptyContext, sessionId: () => generateSessionId() }),

      on: {
        SELECT_PROGRAM: {
          target: 'selectingPlan',
          actions: assign(({ event }) => ({
            selectedProgram: event.program,
            availablePlans: PLANS_BY_PROGRAM[event.program.id] ?? [],
            selectedPlan: null,
          })),
        },
        TIMEOUT: 'timeout',
        RESET: 'selectingProgram',
      },
    },

    // ── Step 2: Plan selection ────────────────────────────────────────────────
    selectingPlan: {
      on: {
        SELECT_PLAN: {
          actions: assign({ selectedPlan: ({ event }) => event.plan }),
        },
        SUBMIT_PAYMENT: {
          target: 'reviewingCommitment',
          guard: 'isPlanSelected',
        },
        BACK: 'selectingProgram',
        TIMEOUT: 'timeout',
        RESET: 'selectingProgram',
      },
    },

    // ── Step 3: Commitment / waiver ───────────────────────────────────────────
    reviewingCommitment: {
      entry: assign({ hasAgreedToCommitment: false }),

      on: {
        UPDATE_FIELD: {
          actions: assign(({ event, context }) => ({
            ...context,
            [event.field]: event.value,
          })),
        },
        SUBMIT_COMMITMENT: {
          target: 'collectingInfo',
          guard: 'hasAgreedToCommitment',
        },
        BACK: 'selectingPlan',
        TIMEOUT: 'timeout',
        RESET: 'selectingProgram',
      },
    },

    // ── Step 4: Member info form ──────────────────────────────────────────────
    collectingInfo: {
      entry: assign({ isSubmitting: false, errors: {} as Record<string, string> }),

      on: {
        UPDATE_FIELD: {
          actions: assign(({ event, context }) => {
            const { field, value } = event;
            const newErrors = { ...context.errors };
            delete newErrors[field as string];
            return { ...context, [field]: value, errors: newErrors };
          }),
        },
        LOOKUP_MEMBER: 'lookingUpMember',
        SUBMIT_CONTACT: 'validatingContact',
        BACK: 'reviewingCommitment',
        TIMEOUT: 'timeout',
        RESET: 'selectingProgram',
      },
    },

    lookingUpMember: {
      entry: assign({ isSubmitting: true }),
      after: {
        // Mock: always returns no match after 1 second
        1000: {
          target: 'collectingInfo',
          actions: assign({ isSubmitting: false }),
        },
      },
    },

    validatingContact: {
      entry: assign({ isSubmitting: true }),

      always: [
        { target: 'processingPayment', guard: 'isContactInfoValid' },
        {
          target: 'collectingInfo',
          actions: assign(({ context }) => ({
            isSubmitting: false,
            errors: validateContactInfo(context),
          })),
        },
      ],
    },

    // ── Processing ────────────────────────────────────────────────────────────
    processingPayment: {
      after: {
        3000: 'creatingMembership',
      },
      on: {
        PAYMENT_FAILED: {
          target: 'paymentFailed',
          actions: assign({ errors: { general: 'Payment failed. Please try again.' } as Record<string, string> }),
        },
        TIMEOUT: 'timeout',
      },
    },

    creatingMembership: {
      entry: assign({ isSubmitting: true }),
      after: {
        2000: {
          target: 'success',
          actions: assign({ isSubmitting: false }),
        },
      },
      on: { TIMEOUT: 'timeout' },
    },

    // ── Terminal states ───────────────────────────────────────────────────────
    paymentFailed: {
      on: {
        TRY_AGAIN: 'selectingPlan',
        RESET: 'selectingProgram',
      },
    },

    success: {
      entry: ['auditMembershipCreation'],
      after: { 15000: 'selectingProgram' },
      on: { RESET: 'selectingProgram' },
    },

    error: {
      entry: assign({ isSubmitting: false }),
      on: {
        TRY_AGAIN: 'collectingInfo',
        RESET: 'selectingProgram',
      },
    },

    timeout: {
      entry: ['auditTimeout'],
      after: { 3000: 'selectingProgram' },
      on: { RESET: 'selectingProgram' },
    },
  },
}).provide({
  guards: membershipGuards,
  actions: membershipActions,
});
