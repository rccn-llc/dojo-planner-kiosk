import type { MemberAreaContext, MemberAreaEvent } from './types';
import { assign, createMachine } from 'xstate';
import { KioskAuditService } from '../services/audit';
import { generateSessionId, isValidEmail, isValidPhoneNumber } from '../shared/utils';

// Helper functions (defined before machine creation)
function validateMemberInfo(context: MemberAreaContext): Record<string, string> {
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
const memberAreaGuards = {
  isProgramSelected: ({ context }: { context: MemberAreaContext }) => {
    return !!context.selectedProgram;
  },

  isPlanSelected: ({ context }: { context: MemberAreaContext }) => {
    return !!context.selectedPlan;
  },

  isMemberInfoValid: ({ context }: { context: MemberAreaContext }) => {
    const errors = validateMemberInfo(context);
    return Object.keys(errors).length === 0;
  },
};

// Actions
const memberAreaActions = {
  auditUpgradeComplete: ({ context }: { context: MemberAreaContext }) => {
    if (context.selectedPlan && context.email) {
      const audit = KioskAuditService.getInstance();
      audit.logMembershipSignup(
        {
          id: `upgrade_${Date.now()}`,
          email: context.email,
          firstName: context.firstName,
          lastName: context.lastName,
        },
        {
          planId: context.selectedPlan.id,
          amount: context.selectedPlan.price,
          subscriptionId: `sub_${Date.now()}`,
        },
        {
          sessionId: context.sessionId,
          phoneNumber: context.phoneNumber,
        },
      );
    }
  },

  auditTimeout: ({ context }: { context: MemberAreaContext }) => {
    const audit = KioskAuditService.getInstance();
    audit.logSession('timeout', {
      sessionId: context.sessionId,
      phoneNumber: context.phoneNumber,
    });
  },
};

// Member Area flow state machine
export const memberAreaMachine = createMachine({
  id: 'memberArea',
  types: {} as {
    context: MemberAreaContext;
    events: MemberAreaEvent;
  },
  initial: 'selectingProgram',
  context: {
    selectedProgram: null,
    selectedPlan: null,
    firstName: '',
    lastName: '',
    email: '',
    phoneNumber: '',
    password: '',
    sessionId: '',
    errors: {} as Record<string, string>,
    isSubmitting: false,
  },
  states: {
    selectingProgram: {
      entry: assign(() => ({
        sessionId: generateSessionId(),
        errors: {} as Record<string, string>,
      })),

      on: {
        SELECT_PROGRAM: {
          target: 'selectingPlan',
          actions: assign({
            selectedProgram: ({ event }) => event.program,
          }),
        },

        RESET: 'selectingProgram',
      },
    },

    selectingPlan: {
      entry: assign({
        errors: {} as Record<string, string>,
      }),

      on: {
        SELECT_PLAN: {
          target: 'reviewingCommitment',
          actions: assign({
            selectedPlan: ({ event }) => event.plan,
          }),
        },

        BACK: 'selectingProgram',
        RESET: 'selectingProgram',
      },
    },

    reviewingCommitment: {
      on: {
        CONTINUE: 'collectingInfo',
        BACK: 'selectingPlan',
        RESET: 'selectingProgram',
      },
    },

    collectingInfo: {
      entry: assign({
        isSubmitting: false,
        errors: {} as Record<string, string>,
      }),

      on: {
        UPDATE_INFO: {
          actions: assign({
            firstName: ({ event }) => event.firstName || '',
            lastName: ({ event }) => event.lastName || '',
            email: ({ event }) => event.email || '',
            phoneNumber: ({ event }) => event.phoneNumber || '',
          }),
        },

        SUBMIT: {
          target: 'validatingInfo',
          guard: 'isMemberInfoValid',
          actions: assign({
            isSubmitting: true,
            errors: {} as Record<string, string>,
          }),
        },

        INVALID_INFO: {
          target: 'collectingInfo',
          actions: assign(({ context }) => ({
            errors: validateMemberInfo(context),
          })),
        },

        BACK: 'reviewingCommitment',
        RESET: 'selectingProgram',
      },
    },

    validatingInfo: {
      entry: assign({
        isSubmitting: true,
      }),

      after: {
        2000: {
          target: 'success',
          actions: assign({
            isSubmitting: false,
          }),
        },
      },

      on: {
        RESET: 'selectingProgram',
      },
    },

    success: {
      entry: [
        assign({
          isSubmitting: false,
        }),
        'auditUpgradeComplete',
      ],

      after: {
        15000: 'selectingProgram', // Auto-reset after 15 seconds
      },

      on: {
        RESET: 'selectingProgram',
      },
    },

    timeout: {
      entry: [
        assign({
          isSubmitting: false,
        }),
        'auditTimeout',
      ],

      after: {
        3000: 'selectingProgram',
      },

      on: {
        RESET: 'selectingProgram',
      },
    },
  },
}).provide({
  guards: memberAreaGuards,
  actions: memberAreaActions,
});
