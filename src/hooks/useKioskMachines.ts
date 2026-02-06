import { useMachine } from '@xstate/react';
import { checkinMachine } from '../machines/checkinMachine';
import { memberAreaMachine } from '../machines/memberAreaMachine';
import { membershipMachine } from '../machines/membershipMachine';
import { trialMachine } from '../machines/trialMachine';

// Hook for member check-in machine
export function useCheckinMachine() {
  return useMachine(checkinMachine);
}

// Hook for trial signup machine
export function useTrialMachine() {
  return useMachine(trialMachine);
}

// Hook for membership signup machine
export function useMembershipMachine() {
  return useMachine(membershipMachine);
}

// Hook for member area machine
export function useMemberAreaMachine() {
  return useMachine(memberAreaMachine);
}

// Function for managing session timeouts across all machines
export function createSessionTimeout(_machine: any) {
  // TODO: Implement global session timeout management
  // This would monitor inactivity and send TIMEOUT events
  return {
    resetTimeout: () => {
      // Reset inactivity timer
    },
    clearTimeout: () => {
      // Clear timeout when user leaves
    },
  };
}
