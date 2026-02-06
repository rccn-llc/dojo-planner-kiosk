import type { Program } from '../shared/types';
import type { TrialContext, TrialEvent } from './types';
import { assign, createMachine } from 'xstate';
import { KioskAuditService } from '../services/audit';
import { generateSessionId, isValidEmail, isValidPhoneNumber } from '../shared/utils';

// Validation function
function validateContactInfo(context: TrialContext): Record<string, string> {
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
export const trialGuards = {
  isContactInfoValid: ({ context }: { context: TrialContext }) => {
    const errors = validateContactInfo(context);
    return Object.keys(errors).length === 0;
  },

  isProgramSelected: ({ context }: { context: TrialContext }) => {
    return !!context.selectedProgram;
  },
};

// Actions
export const trialActions = {
  auditTrialCreation: ({ context }: { context: TrialContext }) => {
    if (context.selectedProgram && context.email) {
      const audit = KioskAuditService.getInstance();
      audit.logTrialSignup(
        {
          id: `trial_${Date.now()}`,
          programId: context.selectedProgram.id,
          email: context.email,
          firstName: context.firstName,
          lastName: context.lastName,
        },
        {
          sessionId: context.sessionId,
          phoneNumber: context.phoneNumber,
        },
      );
    }
  },

  auditTimeout: ({ context }: { context: TrialContext }) => {
    const audit = KioskAuditService.getInstance();
    audit.logSession('timeout', {
      sessionId: context.sessionId,
      phoneNumber: context.phoneNumber,
    });
  },
};

// Services
export const trialServices = {
  loadPrograms: async () => {
    // TODO: Load programs from API
    // For now, return mock data
    return [
      {
        id: '1',
        name: 'Martial Arts Basics',
        description: 'Learn fundamental techniques and forms',
        trialLength: 14,
        price: 120,
        isActive: true,
      },
      {
        id: '2',
        name: 'Youth Program',
        description: 'Martial arts training for kids and teens',
        trialLength: 7,
        price: 100,
        isActive: true,
      },
    ];
  },

  createTrial: async ({ context }: { context: TrialContext }) => {
    // TODO: Create trial via API
    // For now, simulate API call
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (!context.selectedProgram || !context.email) {
      throw new Error('Missing required information');
    }

    return {
      id: `trial_${Date.now()}`,
      status: 'created',
      programId: context.selectedProgram.id,
    };
  },
};

// Trial signup state machine
export const trialMachine = createMachine({
  id: 'trial',
  types: {} as {
    context: TrialContext;
    events: TrialEvent;
  },

  context: {
    // Contact info
    firstName: '',
    lastName: '',
    email: '',
    phoneNumber: '',

    // Program selection
    selectedProgram: null,
    availablePrograms: [] as Program[],

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
        availablePrograms: [
          { id: 'karate', name: 'Karate', description: 'Traditional martial art', price: 120, isActive: true },
          { id: 'bjj', name: 'Brazilian Jiu-Jitsu', description: 'Ground fighting art', price: 140, isActive: true },
          { id: 'muay-thai', name: 'Muay Thai', description: 'Thai boxing art', price: 130, isActive: true },
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
          target: 'selectingProgram',
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

    selectingProgram: {
      entry: assign({
        isSubmitting: false,
        errors: {} as Record<string, string>,
      }),

      on: {
        SELECT_PROGRAM: {
          actions: assign({
            selectedProgram: ({ event }) => event.program,
          }),
        },

        SUBMIT_TRIAL: {
          target: 'creatingTrial',
          guard: 'isProgramSelected',
          actions: assign({
          }),
        },

        TIMEOUT: 'timeout',
        RESET: 'idle',
      },
    },

    creatingTrial: {
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
        TIMEOUT: 'timeout',
      },
    },

    success: {
      entry: [
        assign({
        }),
        'auditTrialCreation',
      ],

      after: {
        10000: 'idle', // Auto-reset after 10 seconds
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
        3000: 'idle', // Auto-reset after 3 seconds
      },

      on: {
        RESET: 'idle',
      },
    },
  },
}).provide({
  guards: trialGuards,
  actions: trialActions,
});
