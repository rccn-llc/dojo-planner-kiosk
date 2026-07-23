import { isValidEmail } from './utils';

// Shared strict format checks used by the member-portal OTP routes.
const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const OTP_RE = /^\d{6}$/;
const CLERK_USER_ID_RE = /^user_[A-Za-z0-9]{8,}$/;

export const isValidUUID = (value: string): boolean => UUID_RE.test(value);
export const isValidOTPCode = (value: string): boolean => OTP_RE.test(value);
export const isValidClerkUserId = (value: string): boolean => CLERK_USER_ID_RE.test(value);

export interface MemberEditFormErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  [key: string]: string | undefined;
}

interface MemberEditForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export function validateMemberEditForm(form: MemberEditForm): MemberEditFormErrors {
  const errors: MemberEditFormErrors = {};

  if (!form.firstName.trim()) {
    errors.firstName = 'First name is required';
  }
  if (!form.lastName.trim()) {
    errors.lastName = 'Last name is required';
  }
  if (!form.email.trim()) {
    errors.email = 'Email is required';
  }
  else if (!isValidEmail(form.email)) {
    errors.email = 'Please enter a valid email';
  }
  if (form.phone) {
    const digits = form.phone.replace(/\D/g, '');
    if (digits.length > 0 && digits.length !== 10) {
      errors.phone = 'Please enter a valid 10-digit phone number';
    }
  }
  if (form.dateOfBirth) {
    const dob = new Date(form.dateOfBirth);
    if (Number.isNaN(dob.getTime())) {
      errors.dateOfBirth = 'Please enter a valid date';
    }
    else if (dob > new Date()) {
      errors.dateOfBirth = 'Date of birth cannot be in the future';
    }
  }

  return errors;
}
