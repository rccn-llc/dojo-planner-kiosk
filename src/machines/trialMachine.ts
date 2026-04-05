import type { TrialContext, TrialEvent } from './types';
import { assign, createMachine } from 'xstate';
import { generateSessionId, isValidEmail, isValidPhoneNumber } from '../lib/utils';
import { KioskAuditService } from '../services/audit';

// Validation for contact / details form
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

  if (!context.address?.trim()) {
    errors.address = 'Address is required';
  }
  if (!context.city?.trim()) {
    errors.city = 'City is required';
  }
  if (!context.state?.trim()) {
    errors.state = 'State is required';
  }

  return errors;
}

// Validation for youth parent/guardian form
function validateYouthParent(context: TrialContext): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!context.parentFirstName?.trim()) {
    errors.parentFirstName = 'First name is required';
  }
  if (!context.parentLastName?.trim()) {
    errors.parentLastName = 'Last name is required';
  }

  if (!context.parentEmail?.trim()) {
    errors.parentEmail = 'Email is required';
  }
  else if (!isValidEmail(context.parentEmail)) {
    errors.parentEmail = 'Please enter a valid email';
  }

  if (!context.parentPhone?.trim()) {
    errors.parentPhone = 'Phone number is required';
  }
  else if (!isValidPhoneNumber(context.parentPhone)) {
    errors.parentPhone = 'Please enter a valid 10-digit phone number';
  }

  if (!context.parentAddress?.trim()) {
    errors.parentAddress = 'Address is required';
  }
  if (!context.parentCity?.trim()) {
    errors.parentCity = 'City is required';
  }
  if (!context.parentState?.trim()) {
    errors.parentState = 'State is required';
  }

  return errors;
}

// Validation for youth child form
function validateYouthChild(context: TrialContext): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!context.currentChildFirstName?.trim()) {
    errors.currentChildFirstName = 'First name is required';
  }
  if (!context.currentChildLastName?.trim()) {
    errors.currentChildLastName = 'Last name is required';
  }
  if (!context.currentChildDateOfBirth?.trim()) {
    errors.currentChildDateOfBirth = 'Date of birth is required';
  }
  return errors;
}

// Validation for waiver step
function validateWaiver(context: TrialContext): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!context.waiverAgreed) {
    errors.waiverAgreed = 'You must agree to the waiver to continue';
  }
  if (!context.signature?.trim()) {
    errors.signature = 'Signature is required';
  }
  return errors;
}

// Guards
const trialGuards = {
  isContactInfoValid: ({ context }: { context: TrialContext }) =>
    Object.keys(validateContactInfo(context)).length === 0,

  isYouthParentValid: ({ context }: { context: TrialContext }) =>
    Object.keys(validateYouthParent(context)).length === 0,

  isYouthChildValid: ({ context }: { context: TrialContext }) =>
    Object.keys(validateYouthChild(context)).length === 0,

  isWaiverValid: ({ context }: { context: TrialContext }) =>
    Object.keys(validateWaiver(context)).length === 0,

  isYouthFlow: ({ context }: { context: TrialContext }) =>
    context.ageGroup === 'youth',

  isAddingAdditionalChild: ({ context }: { context: TrialContext }) =>
    context.isAddingAdditionalChild,
};

// Actions
const trialActions = {
  auditTrialCreation: ({ context }: { context: TrialContext }) => {
    if (context.email) {
      const audit = KioskAuditService.getInstance();
      audit.logTrialSignup(
        {
          id: `trial_${Date.now()}`,
          programId: 'adult-trial',
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

const emptyContext: TrialContext = {
  ageGroup: null,
  firstName: '',
  lastName: '',
  email: '',
  phoneNumber: '',
  address: '',
  addressLine2: '',
  city: '',
  state: '',
  parentFirstName: '',
  parentLastName: '',
  parentEmail: '',
  parentPhone: '',
  parentAddress: '',
  parentAddressLine2: '',
  parentCity: '',
  parentState: '',
  currentChildFirstName: '',
  currentChildLastName: '',
  currentChildDateOfBirth: '',
  children: [],
  isAddingAdditionalChild: false,
  selectedProgram: null,
  availablePrograms: [],
  waiverAgreed: false,
  signature: '',
  errors: {},
  isSubmitting: false,
  sessionId: '',
};

// Trial signup state machine
export const trialMachine = createMachine({
  id: 'trial',
  types: {} as {
    context: TrialContext;
    events: TrialEvent;
  },

  context: {
    ...emptyContext,
  },

  initial: 'selectingAge',

  states: {
    // Step 1 – Choose adult or youth
    selectingAge: {
      entry: assign({
        ...emptyContext,
        sessionId: () => generateSessionId(),
      }),

      on: {
        SELECT_AGE_GROUP: [
          {
            target: 'collectingInfo',
            guard: ({ event }) => event.ageGroup === 'adult',
            actions: assign({ ageGroup: ({ event }) => event.ageGroup }),
          },
          {
            target: 'collectingYouthParentInfo',
            actions: assign({ ageGroup: ({ event }) => event.ageGroup }),
          },
        ],
        RESET: 'selectingAge',
      },
    },

    // Youth placeholder
    // (kept for reference - no longer used)

    // Youth Step 2 – Parent/Guardian details
    collectingYouthParentInfo: {
      entry: assign({ errors: {} as Record<string, string>, isSubmitting: false }),

      on: {
        UPDATE_FIELD: {
          actions: assign(({ event, context }) => {
            const { field, value } = event;
            const newErrors = { ...context.errors };
            delete newErrors[field];
            return { ...context, [field]: value, errors: newErrors };
          }),
        },
        SUBMIT_YOUTH_PARENT: 'validatingYouthParent',
        BACK: 'selectingAge',
        TIMEOUT: 'timeout',
        RESET: 'selectingAge',
      },
    },

    validatingYouthParent: {
      entry: assign({ isSubmitting: true }),
      always: [
        {
          target: 'collectingYouthChildInfo',
          guard: 'isYouthParentValid',
          actions: assign({ isSubmitting: false, isAddingAdditionalChild: false }),
        },
        {
          target: 'collectingYouthParentInfo',
          actions: assign(({ context }) => ({
            isSubmitting: false,
            errors: validateYouthParent(context),
          })),
        },
      ],
    },

    // Youth Step 3 – Child details
    collectingYouthChildInfo: {
      entry: assign({ errors: {} as Record<string, string>, isSubmitting: false }),

      on: {
        UPDATE_FIELD: {
          actions: assign(({ event, context }) => {
            const { field, value } = event;
            const newErrors = { ...context.errors };
            delete newErrors[field];
            return { ...context, [field]: value, errors: newErrors };
          }),
        },
        SUBMIT_YOUTH_CHILD: 'validatingYouthChild',
        BACK: [
          {
            target: 'askingAddAnotherChild',
            guard: 'isAddingAdditionalChild',
          },
          { target: 'collectingYouthParentInfo' },
        ],
        TIMEOUT: 'timeout',
        RESET: 'selectingAge',
      },
    },

    validatingYouthChild: {
      entry: assign({ isSubmitting: true }),
      always: [
        {
          // Additional child: save and go to ask-another screen
          target: 'askingAddAnotherChild',
          guard: ({ context }) =>
            Object.keys(validateYouthChild(context)).length === 0
            && context.isAddingAdditionalChild,
          actions: assign(({ context }) => ({
            isSubmitting: false,
            children: [
              ...context.children,
              {
                firstName: context.currentChildFirstName,
                lastName: context.currentChildLastName,
                dateOfBirth: context.currentChildDateOfBirth,
              },
            ],
            currentChildFirstName: '',
            currentChildLastName: '',
            currentChildDateOfBirth: '',
          })),
        },
        {
          // First child: go to waiver
          target: 'collectingWaiver',
          guard: 'isYouthChildValid',
          actions: assign({ isSubmitting: false }),
        },
        {
          target: 'collectingYouthChildInfo',
          actions: assign(({ context }) => ({
            isSubmitting: false,
            errors: validateYouthChild(context),
          })),
        },
      ],
    },

    // Youth Step 5 – Add another child?
    askingAddAnotherChild: {
      on: {
        ADD_ANOTHER_CHILD: {
          target: 'collectingYouthChildInfo',
          actions: assign({
            isAddingAdditionalChild: true,
            currentChildFirstName: '',
            currentChildLastName: '',
            currentChildDateOfBirth: '',
          }),
        },
        FINISH_YOUTH: 'creatingTrial',
        TIMEOUT: 'timeout',
        RESET: 'selectingAge',
      },
    },

    // Step 2 – Collect contact + address details (adult)
    collectingInfo: {
      on: {
        UPDATE_FIELD: {
          actions: assign(({ event, context }) => {
            const { field, value } = event;
            const newErrors = { ...context.errors };
            delete newErrors[field];
            return { ...context, [field]: value, errors: newErrors };
          }),
        },

        SUBMIT_CONTACT: 'validatingContact',
        BACK: 'selectingAge',
        TIMEOUT: 'timeout',
        RESET: 'selectingAge',
      },
    },

    // Validation guard state
    validatingContact: {
      entry: assign({ isSubmitting: true }),

      always: [
        {
          target: 'collectingWaiver',
          guard: 'isContactInfoValid',
          actions: assign({ isSubmitting: false }),
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

    // Step 3 – Waiver & Agreement (adult) / Step 4 (youth)
    collectingWaiver: {
      entry: assign({ errors: {} as Record<string, string> }),

      on: {
        UPDATE_FIELD: {
          actions: assign(({ event, context }) => {
            const { field, value } = event;
            const newErrors = { ...context.errors };
            delete newErrors[field];
            return { ...context, [field]: value, errors: newErrors };
          }),
        },

        AGREE_WAIVER: {
          actions: assign(({ event, context }) => {
            const newErrors = { ...context.errors };
            delete newErrors.waiverAgreed;
            return { ...context, waiverAgreed: event.agreed, errors: newErrors };
          }),
        },

        SUBMIT_WAIVER: 'validatingWaiver',
        BACK: [
          { target: 'collectingYouthChildInfo', guard: 'isYouthFlow' },
          { target: 'collectingInfo' },
        ],
        TIMEOUT: 'timeout',
        RESET: 'selectingAge',
      },
    },

    // Waiver validation guard state
    validatingWaiver: {
      entry: assign({ isSubmitting: true }),

      always: [
        {
          // Youth: save first child to array, go to ask-another
          target: 'askingAddAnotherChild',
          guard: ({ context }) =>
            Object.keys(validateWaiver(context)).length === 0
            && context.ageGroup === 'youth',
          actions: assign(({ context }) => ({
            isSubmitting: false,
            children: [
              ...context.children,
              {
                firstName: context.currentChildFirstName,
                lastName: context.currentChildLastName,
                dateOfBirth: context.currentChildDateOfBirth,
              },
            ],
            currentChildFirstName: '',
            currentChildLastName: '',
            currentChildDateOfBirth: '',
          })),
        },
        {
          // Adult: go straight to creating
          target: 'creatingTrial',
          guard: 'isWaiverValid',
          actions: assign({ isSubmitting: false }),
        },
        {
          target: 'collectingWaiver',
          actions: assign(({ context }) => ({
            isSubmitting: false,
            errors: validateWaiver(context),
          })),
        },
      ],
    },

    // Step 4 – Submit
    creatingTrial: {
      entry: assign({ isSubmitting: true }),

      on: {
        TRIAL_CREATED: {
          target: 'success',
          actions: assign({ isSubmitting: false }),
        },
        TRIAL_FAILED: {
          target: 'error',
          actions: assign(({ event }) => ({
            isSubmitting: false,
            errors: { general: event.error ?? 'Trial signup failed. Please try again.' },
          })),
        },
        TIMEOUT: 'timeout',
      },
    },

    // Step 5 – Success
    success: {
      entry: ['auditTrialCreation'],

      after: {
        10000: 'selectingAge',
      },

      on: {
        RESET: 'selectingAge',
      },
    },

    error: {
      entry: assign({ isSubmitting: false }),

      on: {
        TRY_AGAIN: 'collectingInfo',
        RESET: 'selectingAge',
      },
    },

    timeout: {
      entry: ['auditTimeout'],

      after: {
        3000: 'selectingAge',
      },

      on: {
        RESET: 'selectingAge',
      },
    },
  },
}).provide({
  guards: trialGuards,
  actions: trialActions,
});
