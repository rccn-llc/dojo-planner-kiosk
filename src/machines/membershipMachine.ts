import type { MembershipContext, MembershipEvent } from './types';
import { assign, createMachine } from 'xstate';
import { generateSessionId, isValidEmail, isValidPhoneNumber } from '../lib/utils';
import { KioskAuditService } from '../services/audit';

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
  if (!context.dateOfBirth?.trim()) {
    errors.dateOfBirth = 'Date of birth is required';
  }
  else {
    const dob = new Date(context.dateOfBirth);
    if (Number.isNaN(dob.getTime())) {
      errors.dateOfBirth = 'Please enter a valid date';
    }
    else if (dob > new Date()) {
      errors.dateOfBirth = 'Date of birth cannot be in the future';
    }
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
  isLoadingPrograms: true,
  selectedProgram: null,
  programs: [],
  plansByProgram: {},
  selectedPlan: null,
  availablePlans: [],
  firstName: '',
  lastName: '',
  email: '',
  phoneNumber: '',
  dateOfBirth: '',
  guardianFirstName: '',
  guardianLastName: '',
  guardianEmail: '',
  guardianRelationship: 'parent',
  address: '',
  addressLine2: '',
  city: '',
  state: '',
  zip: '',
  hasAgreedToCommitment: false,
  waiverSignature: '',
  waiverContent: '',
  waiverTemplateName: '',
  isLoadingWaiver: false,
  memberLookupPhone: '',
  memberLookupResult: null,
  convertingTrialMembershipId: null,
  existingMemberId: null,
  paymentMethod: 'card' as const,
  cardholderName: '',
  cardToken: '',
  cardFirstSix: '',
  cardLastFour: '',
  cardExpiry: '',
  achAccountHolder: '',
  achRoutingNumber: '',
  achAccountNumber: '',
  achAccountType: 'Checking' as const,
  errors: {} as Record<string, string>,
  isSubmitting: false,
  sessionId: '',
};

// ── Guards ────────────────────────────────────────────────────────────────────

const membershipGuards = {
  isContactInfoValid: ({ context }: { context: MembershipContext }) =>
    Object.keys(validateContactInfo(context)).length === 0,

  isPlanSelected: ({ context }: { context: MembershipContext }) =>
    !!context.selectedPlan,

  hasAgreedToCommitment: ({ context }: { context: MembershipContext }) =>
    !!context.hasAgreedToCommitment,
};

// ── Actions ───────────────────────────────────────────────────────────────────

const membershipActions = {
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
      entry: assign({
        ...emptyContext,
        sessionId: () => generateSessionId(),
      }),

      on: {
        PROGRAMS_LOADED: {
          actions: assign(({ event }) => ({
            isLoadingPrograms: false,
            programs: event.programs,
            plansByProgram: event.plansByProgram,
          })),
        },
        PROGRAMS_FAILED: {
          actions: assign({ isLoadingPrograms: false }),
        },
        SELECT_PROGRAM: {
          target: 'selectingPlan',
          actions: assign(({ event, context }) => ({
            selectedProgram: event.program,
            availablePlans: context.plansByProgram[event.program.id] ?? [],
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
          target: 'collectingInfo',
          guard: 'isPlanSelected',
        },
        BACK: 'selectingProgram',
        TIMEOUT: 'timeout',
        RESET: 'selectingProgram',
      },
    },

    // ── Step 3: Member info form ──────────────────────────────────────────────
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
        // Also accept MEMBER_FOUND here — when multiple results are shown
        // in an overlay picker, the machine is already back in collectingInfo
        MEMBER_FOUND: {
          actions: assign(({ event, context }) => ({
            firstName: event.member.firstName,
            lastName: event.member.lastName,
            email: event.member.email,
            phoneNumber: event.member.phoneNumber,
            dateOfBirth: event.member.dateOfBirth ?? context.dateOfBirth,
            address: event.member.address ?? context.address,
            city: event.member.city ?? context.city,
            state: event.member.state ?? context.state,
            zip: event.member.zip ?? context.zip,
            memberLookupResult: event.member,
            existingMemberId: event.member.id,
            convertingTrialMembershipId: event.member.trialMembershipId ?? null,
            waiverSignature: event.member.existingSignature ?? context.waiverSignature,
          })),
        },
        SUBMIT_CONTACT: 'validatingContact',
        BACK: 'selectingPlan',
        TIMEOUT: 'timeout',
        RESET: 'selectingProgram',
      },
    },

    lookingUpMember: {
      entry: assign({ isSubmitting: true }),
      on: {
        MEMBER_FOUND: {
          target: 'collectingInfo',
          actions: assign(({ event, context }) => ({
            isSubmitting: false,
            firstName: event.member.firstName,
            lastName: event.member.lastName,
            email: event.member.email,
            phoneNumber: event.member.phoneNumber,
            dateOfBirth: event.member.dateOfBirth ?? context.dateOfBirth,
            address: event.member.address ?? context.address,
            city: event.member.city ?? context.city,
            state: event.member.state ?? context.state,
            zip: event.member.zip ?? context.zip,
            memberLookupResult: event.member,
            existingMemberId: event.member.id,
            convertingTrialMembershipId: event.member.trialMembershipId ?? null,
            waiverSignature: event.member.existingSignature ?? context.waiverSignature,
          })),
        },
        MEMBER_NOT_FOUND: {
          target: 'collectingInfo',
          actions: assign({ isSubmitting: false }),
        },
      },
    },

    validatingContact: {
      entry: assign({ isSubmitting: true }),

      always: [
        { target: 'reviewingCommitment', guard: 'isContactInfoValid' },
        {
          target: 'collectingInfo',
          actions: assign(({ context }) => ({
            isSubmitting: false,
            errors: validateContactInfo(context),
          })),
        },
      ],
    },

    // ── Step 4: Commitment / waiver ───────────────────────────────────────────
    reviewingCommitment: {
      entry: assign({ hasAgreedToCommitment: false, isLoadingWaiver: true }),

      on: {
        WAIVER_LOADED: {
          actions: assign(({ event }) => ({
            isLoadingWaiver: false,
            waiverContent: event.content,
            waiverTemplateName: event.templateName,
          })),
        },
        WAIVER_FAILED: {
          actions: assign({ isLoadingWaiver: false }),
        },
        UPDATE_FIELD: {
          actions: assign(({ event, context }) => ({
            ...context,
            [event.field]: event.value,
          })),
        },
        SUBMIT_COMMITMENT: {
          target: 'collectingPayment',
          guard: 'hasAgreedToCommitment',
        },
        BACK: 'collectingInfo',
        TIMEOUT: 'timeout',
        RESET: 'selectingProgram',
      },
    },

    collectingPayment: {
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
        SUBMIT_PAYMENT: 'processingPayment',
        BACK: 'collectingInfo',
        TIMEOUT: 'timeout',
        RESET: 'selectingProgram',
      },
    },

    // ── Processing ────────────────────────────────────────────────────────────
    processingPayment: {
      entry: assign({ isSubmitting: true }),
      on: {
        PAYMENT_SUCCESS: {
          target: 'success',
          actions: assign({ isSubmitting: false }),
        },
        PAYMENT_FAILED: {
          target: 'paymentFailed',
          actions: assign(({ event }) => ({
            isSubmitting: false,
            errors: { general: event.error ?? 'Payment failed. Please try again.' } as Record<string, string>,
          })),
        },
        TIMEOUT: 'timeout',
      },
    },

    // ── Terminal states ───────────────────────────────────────────────────────
    paymentFailed: {
      on: {
        TRY_AGAIN: 'collectingPayment',
        RESET: 'selectingProgram',
      },
    },

    success: {
      entry: ['auditMembershipCreation'],
      // 65s safety net — component drives the 60s countdown and calls onComplete
      after: { 65000: 'selectingProgram' },
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
