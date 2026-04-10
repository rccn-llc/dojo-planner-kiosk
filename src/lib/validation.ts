import { isValidEmail } from './utils';

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
