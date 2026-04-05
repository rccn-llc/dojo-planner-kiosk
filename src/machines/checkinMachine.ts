import type { CheckinContext, CheckinEvent } from './types';
import { assign, createMachine } from 'xstate';
import { generateSessionId, isValidPhoneNumber } from '../lib/utils';

export const checkinMachine = createMachine({
  id: 'checkin',
  types: {} as {
    context: CheckinContext;
    events: CheckinEvent;
  },
  initial: 'idle',
  context: {
    phoneNumber: '',
    members: [],
    selectedMember: null,
    classes: [],
    selectedClass: null,
    sessionId: '',
    errors: {} as Record<string, string>,
  },
  states: {
    // Step 1: Enter phone number
    idle: {
      entry: assign({
        phoneNumber: '',
        members: [],
        selectedMember: null,
        classes: [],
        selectedClass: null,
        sessionId: '',
        errors: {} as Record<string, string>,
      }),
      on: {
        ENTER_PHONE: {
          target: 'lookingUp',
          guard: ({ event }) => isValidPhoneNumber(event.phoneNumber),
          actions: assign(({ event }) => ({
            phoneNumber: event.phoneNumber,
            sessionId: generateSessionId(),
            errors: {} as Record<string, string>,
          })),
        },
      },
    },

    // Looking up member by phone (component calls API and sends event)
    lookingUp: {
      on: {
        MEMBERS_FOUND: {
          target: 'selectingMember',
          actions: assign(({ event }) => ({
            members: event.members,
          })),
        },
        MEMBER_NOT_FOUND: {
          target: 'notFound',
        },
        RESET: 'idle',
      },
    },

    // Step 1b: If multiple members share a phone, pick one
    selectingMember: {
      on: {
        SELECT_MEMBER: {
          target: 'loadingClasses',
          actions: assign(({ event }) => ({
            selectedMember: event.member,
          })),
        },
        BACK: 'idle',
        RESET: 'idle',
      },
    },

    // Loading today's classes (component calls API and sends event)
    loadingClasses: {
      on: {
        CLASSES_LOADED: {
          target: 'selectingClass',
          actions: assign(({ event }) => ({
            classes: event.classes,
          })),
        },
        NO_ACTIVE_MEMBERSHIP: {
          target: 'noMembership',
          actions: assign(({ event }) => ({
            errors: { general: event.message },
          })),
        },
        RESET: 'idle',
      },
    },

    // Step 2: Select a class to check into
    selectingClass: {
      on: {
        SELECT_CLASS: {
          target: 'processingCheckin',
          actions: assign(({ event }) => ({
            selectedClass: event.classItem,
          })),
        },
        BACK: 'idle',
        RESET: 'idle',
      },
    },

    // Processing check-in (component calls API and sends event)
    processingCheckin: {
      on: {
        CHECKIN_SUCCESS: 'checkinComplete',
        CHECKIN_FAILED: {
          target: 'error',
          actions: assign(({ event }) => ({
            errors: { general: event.error ?? 'Check-in failed. Please try again.' },
          })),
        },
        RESET: 'idle',
      },
    },

    // Success
    checkinComplete: {
      after: {
        5000: 'idle',
      },
      on: {
        RESET: 'idle',
      },
    },

    // No active membership
    noMembership: {
      on: {
        TRY_AGAIN: 'idle',
        RESET: 'idle',
      },
    },

    // Member not found
    notFound: {
      on: {
        TRY_AGAIN: 'idle',
        RESET: 'idle',
      },
    },

    // Error
    error: {
      on: {
        TRY_AGAIN: 'idle',
        RESET: 'idle',
      },
    },
  },
});
