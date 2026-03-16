// Shared utility functions for the kiosk application
// These are kiosk-specific utilities along with some basic shared functions

// Basic date utilities
export const formatDate = (date: Date): string => {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
};

export const formatTime = (date: Date): string => {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
};

// Basic string utilities
export const capitalizeWords = (str: string): string => {
  return str.replace(/\w\S*/g, txt =>
    txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
};

export const slugify = (str: string): string => {
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

// Kiosk-specific utilities
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

// Session management utilities
export const generateSessionId = (): string => {
  return `kiosk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const isSessionExpired = (startTime: Date, timeoutMinutes: number = 5): boolean => {
  const now = new Date();
  const elapsed = (now.getTime() - startTime.getTime()) / 1000 / 60; // minutes
  return elapsed > timeoutMinutes;
};
