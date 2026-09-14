// Kiosk utility functions

export const formatPhoneForDisplay = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
};

export const sanitizePhoneInput = (phone: string): string => {
  return phone.replace(/\D/g, '');
};

export const isValidPhoneNumber = (phone: string): boolean => {
  const cleaned = sanitizePhoneInput(phone);
  return cleaned.length === 10;
};

export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const generateSessionId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `kiosk_${Date.now()}_${hex}`;
};

/**
 * Escape a string for safe interpolation into HTML (email bodies, etc.).
 * Member-controlled values (names, plan/product names) must pass through this
 * before landing in an HTML template, or a value like `<img onerror=...>` would
 * be rendered as markup in the recipient's client.
 */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Mask the local part of an email for display in unauthenticated/OTP flows,
 * e.g. `jane.doe@example.com` → `j******e@example.com`.
 */
export const maskEmail = (email: string): string => {
  const [user, domain] = email.split('@');
  if (!user || !domain) {
    return email;
  }
  const maskedUser = user.length > 2
    ? `${user[0]}${'*'.repeat(user.length - 2)}${user[user.length - 1]}`
    : user;
  return `${maskedUser}@${domain}`;
};

/**
 * Today's date as `YYYY-MM-DD` in the kiosk's local timezone.
 *
 * Deliberately NOT `toISOString()` — that converts to UTC first, so a kiosk in
 * a negative-offset timezone would report tomorrow's date for most of the
 * evening and accept a "future" DOB that is actually in the future locally.
 */
export const todayLocalISO = (): string => {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
};

/**
 * True when `value` (a `YYYY-MM-DD` string) is a real calendar date that is not
 * after today. Empty strings are treated as "nothing to check" and pass — the
 * required-ness of a DOB is a separate check.
 *
 * Compared as strings against [[todayLocalISO]] so there is no timezone shift:
 * `YYYY-MM-DD` sorts lexicographically the same way it sorts chronologically.
 */
const isRealCalendarDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  // Reject impossible days (Feb 30) rather than letting Date roll them over
  // into March — `new Date('2026-02-30')` does exactly that, silently.
  return day <= new Date(year, month, 0).getDate();
};

const isValidPastDate = (value: string): boolean => {
  if (!value?.trim()) {
    return true;
  }
  if (!isRealCalendarDate(value)) {
    return false;
  }
  return value.trim() <= todayLocalISO();
};

/**
 * Validation message for a date-of-birth field, or `undefined` when it is fine.
 * Shared by every flow so "Nov 2026" is rejected identically in Trial,
 * Membership, and the member-profile editor.
 */
export const dateOfBirthError = (value: string): string | undefined => {
  if (!value?.trim()) {
    return undefined;
  }
  // Distinguish "that isn't a date" from "that date hasn't happened yet" — the
  // two need different messages, and a shape-only regex can't tell Feb 30 from
  // a real day.
  if (!isRealCalendarDate(value)) {
    return 'Please enter a valid date';
  }
  return isValidPastDate(value) ? undefined : 'Date of birth cannot be in the future';
};

/**
 * Join names for display: `A`, `A and B`, `A, B and C`.
 * Used on success screens that may name one person or several.
 */
export const formatNameList = (names: string[]): string => {
  if (names.length === 0) {
    return '';
  }
  if (names.length === 1) {
    return names[0]!;
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};
