import { useMachine } from '@xstate/react';
import { checkinMachine } from '../machines/checkinMachine';
import { membershipMachine } from '../machines/membershipMachine';
import { storeMachine } from '../machines/storeMachine';
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

// Hook for store / checkout machine
export function useStoreMachine() {
  return useMachine(storeMachine);
}
