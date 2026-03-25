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
  return `kiosk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};
