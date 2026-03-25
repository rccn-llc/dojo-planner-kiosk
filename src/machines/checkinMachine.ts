import type { CheckinContext, CheckinEvent } from './types';
import { assign, createMachine } from 'xstate';
import { generateSessionId, isValidPhoneNumber } from '../lib/utils';

// Member check-in state machine
export const checkinMachine = createMachine({
  id: 'checkin',
  types: {} as {
    context: CheckinContext;
    events: CheckinEvent;
  },
  initial: 'idle',
  context: {
    phoneNumber: '',
    member: null,
    sessionId: '',
    errors: {} as Record<string, string>,
  },
  states: {
    idle: {
      entry: assign(({ context }) => ({
        ...context,
        phoneNumber: '',
        member: null,
        sessionId: '',
        errors: {} as Record<string, string>,
      })),
      on: {
        ENTER_PHONE: {
          target: 'validatingPhone',
          actions: assign(({ event }) => ({
            phoneNumber: event.phoneNumber,
            errors: {} as Record<string, string>,
          })),
          guard: ({ event }) => isValidPhoneNumber(event.phoneNumber),
        },
        INVALID_PHONE: {
          target: 'idle',
          actions: assign({
            errors: { phone: 'Please enter a valid phone number' },
          }),
        },
      },
    },
    validatingPhone: {
      entry: assign(() => ({ sessionId: generateSessionId() })),
      after: {
        2000: {
          target: 'memberFound',
          actions: assign({
            member: {
              id: 'mock_member_123',
              firstName: 'John',
              lastName: 'Doe',
              email: 'john@example.com',
              phoneNumber: '5551234567',
              status: 'active' as const,
              joinedAt: new Date('2024-01-01'),
              lastCheckIn: new Date('2024-01-25'),
            },
          }),
        }, // Simulate async lookup
      },
      on: {
        RESET: { target: 'idle' },
      },
    },
    memberFound: {
      on: {
        CONFIRM_CHECKIN: {
          target: 'processingCheckin',
        },
        RESET: {
          target: 'idle',
        },
      },
    },
    processingCheckin: {
      after: {
        1000: { target: 'checkinComplete' }, // Simulate async checkin
      },
      on: {
        RESET: { target: 'idle' },
      },
    },
    checkinComplete: {
      after: {
        5000: { target: 'idle' },
      },
      on: {
        RESET: { target: 'idle' },
      },
    },
    memberNotFound: {
      on: {
        TRY_AGAIN: { target: 'idle' },
        GO_TO_TRIAL: { target: 'idle' },
        RESET: { target: 'idle' },
      },
    },
    checkinError: {
      on: {
        TRY_AGAIN: { target: 'processingCheckin' },
        RESET: { target: 'idle' },
      },
    },
  },
});
