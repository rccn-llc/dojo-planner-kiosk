import type { MembershipPlan } from '../shared/types';
import type { MembershipContext, MembershipEvent } from './types';
import { assign, createMachine } from 'xstate';
import { KioskAuditService } from '../services/audit';
import { generateSessionId, isValidEmail, isValidPhoneNumber } from '../shared/utils';

// Validation function
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

  return errors;
}

// Guards
export const membershipGuards = {
  isContactInfoValid: ({ context }: { context: MembershipContext }) => {
    const errors = validateContactInfo(context);
    return Object.keys(errors).length === 0;
  },

  isPlanSelected: ({ context }: { context: MembershipContext }) => {
    return !!context.selectedPlan;
  },
};

// Actions
export const membershipActions = {
  auditMembershipCreation: ({ context }: { context: MembershipContext }) => {
    if (context.selectedPlan && context.email && context.subscriptionId) {
      const audit = KioskAuditService.getInstance();
      audit.logMembershipSignup(
        {
          id: `member_${Date.now()}`,
          email: context.email,
          firstName: context.firstName,
          lastName: context.lastName,
        },
        {
          planId: context.selectedPlan.id,
          amount: context.selectedPlan.price,
          subscriptionId: context.subscriptionId,
        },
        {
          sessionId: context.sessionId,
          phoneNumber: context.phoneNumber,
        },
      );
    }
  },

  auditTimeout: ({ context }: { context: MembershipContext }) => {
    const audit = KioskAuditService.getInstance();
    audit.logSession('timeout', {
      sessionId: context.sessionId,
      phoneNumber: context.phoneNumber,
    });
  },
};

// Services
export const membershipServices = {
  loadPlans: async () => {
    // TODO: Load plans from API
    return [
      {
        id: '1',
        name: 'Monthly Membership',
        description: 'Unlimited classes, monthly billing',
        price: 149,
        interval: 'monthly' as const,
        trialPeriodDays: 7,
        isActive: true,
      },
      {
        id: '2',
        name: 'Annual Membership',
        description: 'Unlimited classes, save 20%',
        price: 1429, // ~$119/month
        interval: 'yearly' as const,
        trialPeriodDays: 14,
        isActive: true,
      },
    ];
  },

  processPayment: async ({ context }: { context: MembershipContext }) => {
    // TODO: Process payment via Stripe
    await new Promise(resolve => setTimeout(resolve, 3000));

    if (!context.selectedPlan) {
      throw new Error('No plan selected');
    }

    return {
      customerId: `cus_${Date.now()}`,
      paymentMethodId: `pm_${Date.now()}`,
    };
  },

  createMembership: async ({ context }: { context: MembershipContext }) => {
    // TODO: Create membership and subscription via API
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (!context.selectedPlan || !context.customerId) {
      throw new Error('Missing required information');
    }

    return {
      id: `member_${Date.now()}`,
      subscriptionId: `sub_${Date.now()}`,
      status: 'active',
    };
  },
};

// Membership signup state machine
export const membershipMachine = createMachine({
  id: 'membership',
  types: {} as {
    context: MembershipContext;
    events: MembershipEvent;
  },

  context: {
    // Contact info
    firstName: '',
    lastName: '',
    email: '',
    phoneNumber: '',

    // Membership selection
    selectedPlan: null,
    availablePlans: [] as MembershipPlan[],

    // Payment info
    paymentMethodId: '',
    customerId: '',
    subscriptionId: '',

    // Form validation and state
    errors: {} as Record<string, string>,
    isSubmitting: false,
    sessionId: '',
  },

  initial: 'idle',

  states: {
    idle: {
      entry: assign({
        sessionId: () => generateSessionId(),
        errors: {} as Record<string, string>,
        isSubmitting: false,
      }),

      on: {
        UPDATE_FIELD: {
          target: 'collectingInfo',
          actions: assign({
          }),
        },
      },
    },

    collectingInfo: {
      entry: assign({
        availablePlans: [
          { id: 'basic', name: 'Basic Plan', price: 99, description: 'Basic membership', interval: 'monthly' as const, isActive: true },
          { id: 'premium', name: 'Premium Plan', price: 149, description: 'Premium membership', interval: 'monthly' as const, isActive: true },
          { id: 'family', name: 'Family Plan', price: 199, description: 'Family membership', interval: 'monthly' as const, isActive: true },
        ],
      }),

      on: {
        UPDATE_FIELD: {
          actions: assign(({ event, context }) => {
            const { field, value } = event;
            const newErrors = { ...context.errors };
            delete newErrors[field];
            return {
              ...context,
              [field]: value,
              errors: newErrors,
            };
          }),
        },

        SUBMIT_CONTACT: {
          target: 'validatingContact',
          actions: assign({
          }),
        },

        TIMEOUT: 'timeout',
        RESET: 'idle',
      },
    },

    validatingContact: {
      entry: assign({
        isSubmitting: true,
      }),

      always: [
        {
          target: 'selectingPlan',
          guard: 'isContactInfoValid',
        },
        {
          target: 'collectingInfo',
          actions: assign(({ context }) => ({
            isSubmitting: false,
            errors: validateContactInfo(context),
          })),
        },
      ],
    },

    selectingPlan: {
      entry: assign({
        isSubmitting: false,
        errors: {} as Record<string, string>,
      }),

      on: {
        SELECT_PLAN: {
          actions: assign({
            selectedPlan: ({ event }) => event.plan,
          }),
        },

        SUBMIT_PAYMENT: {
          target: 'processingPayment',
          guard: 'isPlanSelected',
          actions: assign({
          }),
        },

        TIMEOUT: 'timeout',
        RESET: 'idle',
      },
    },

    processingPayment: {
      entry: assign({
      }),

      after: {
        3000: {
          target: 'creatingMembership',
          actions: assign({
            customerId: 'mock_customer_123',
            paymentMethodId: 'mock_payment_123',
          }),
        },
      },

      on: {
        PAYMENT_FAILED: {
          target: 'paymentFailed',
          actions: assign({
            errors: { general: 'Payment failed' } as Record<string, string>,
          }),
        },
        TIMEOUT: 'timeout',
      },
    },

    creatingMembership: {
      entry: assign({
        isSubmitting: true,
      }),

      after: {
        2000: {
          target: 'success',
          actions: assign({
            isSubmitting: false,
            subscriptionId: 'mock_subscription_123',
          }),
        },
      },

      on: {
        TIMEOUT: 'timeout',
      },
    },

    paymentFailed: {
      entry: assign({
      }),

      on: {
        TRY_AGAIN: 'selectingPlan',
        RESET: 'idle',
      },
    },

    success: {
      entry: [
        assign({
        }),
        'auditMembershipCreation',
      ],

      after: {
        15000: 'idle', // Auto-reset after 15 seconds
      },

      on: {
        RESET: 'idle',
      },
    },

    error: {
      entry: assign({
        isSubmitting: false,
      }),

      on: {
        TRY_AGAIN: 'collectingInfo',
        RESET: 'idle',
      },
    },

    timeout: {
      entry: [
        assign({
        }),
        'auditTimeout',
      ],

      after: {
        3000: 'idle',
      },

      on: {
        RESET: 'idle',
      },
    },
  },
}).provide({
  guards: membershipGuards,
  actions: membershipActions,
});
