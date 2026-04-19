// Kiosk type definitions

export interface Member {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string; // Kiosk uses phoneNumber, main app uses phone
  status: 'active' | 'inactive' | 'trial' | 'suspended';
  joinedAt: Date;
  lastCheckIn?: Date;
}

// Program types for trials
export interface Program {
  id: string;
  name: string;
  description: string;
  trialLength?: number; // days
  price: number;
  isActive: boolean;
}

// Membership plan types
export interface MembershipPlan {
  id: string;
  name: string;
  description: string;
  price: number;
  interval: 'monthly' | 'yearly';
  trialPeriodDays?: number;
  isActive: boolean;
}

export interface FeeBreakdown {
  baseAmount: number;
  surchargeAmount: number;
  serviceFeesAmount: number;
  convenienceFeesAmount: number;
  taxAmount: number;
  amount: number;
  isSurchargeable: boolean;
  cardBrand: string | null;
  cardType: string | null;
}
