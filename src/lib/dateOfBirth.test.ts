import { afterEach, describe, expect, it, vi } from 'vitest';
import { dateOfBirthError, todayLocalISO } from './utils';

afterEach(() => {
  vi.useRealTimers();
});

/** Pin wall-clock time to a local-midday instant so no timezone rolls the date. */
function freezeLocalDate(year: number, month: number, day: number) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(year, month - 1, day, 12, 0, 0));
}

describe('todayLocalISO', () => {
  it('formats the LOCAL date, not the UTC one', () => {
    // 23:30 local on the 13th is already the 14th in UTC for any negative
    // offset. `toISOString().split('T')[0]` would report the 14th and accept a
    // DOB of "tomorrow" as valid.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 13, 23, 30, 0));
    expect(todayLocalISO()).toBe('2026-09-13');
  });

  it('zero-pads month and day', () => {
    freezeLocalDate(2026, 1, 5);
    expect(todayLocalISO()).toBe('2026-01-05');
  });
});

describe('dateOfBirthError', () => {
  it('accepts an empty value — required-ness is a separate check', () => {
    expect(dateOfBirthError('')).toBeUndefined();
    expect(dateOfBirthError('   ')).toBeUndefined();
  });

  it('accepts a past date', () => {
    freezeLocalDate(2026, 9, 13);
    expect(dateOfBirthError('1990-04-17')).toBeUndefined();
  });

  it('accepts today', () => {
    freezeLocalDate(2026, 9, 13);
    expect(dateOfBirthError('2026-09-13')).toBeUndefined();
  });

  it('rejects a future month inside the CURRENT year', () => {
    // The reported defect verbatim: it is September 2026 and "November 2026"
    // sailed through, because only the YEAR was being capped.
    freezeLocalDate(2026, 9, 13);
    expect(dateOfBirthError('2026-11-01')).toBe('Date of birth cannot be in the future');
  });

  it('rejects tomorrow', () => {
    freezeLocalDate(2026, 9, 13);
    expect(dateOfBirthError('2026-09-14')).toBe('Date of birth cannot be in the future');
  });

  it('rejects a future year', () => {
    freezeLocalDate(2026, 9, 13);
    expect(dateOfBirthError('2030-01-01')).toBe('Date of birth cannot be in the future');
  });

  it('rejects a malformed date', () => {
    expect(dateOfBirthError('04/17/1990')).toBe('Please enter a valid date');
    expect(dateOfBirthError('1990-4-17')).toBe('Please enter a valid date');
    expect(dateOfBirthError('not-a-date')).toBe('Please enter a valid date');
  });

  it('rejects an impossible calendar day instead of rolling it over', () => {
    // `new Date('2026-02-30')` silently becomes March 2nd; string validation
    // must not. These are malformed dates, NOT future ones, so they get the
    // "valid date" message rather than the "in the future" one.
    freezeLocalDate(2026, 9, 13);
    expect(dateOfBirthError('1990-02-30')).toBe('Please enter a valid date');
    expect(dateOfBirthError('1990-13-01')).toBe('Please enter a valid date');
    expect(dateOfBirthError('1990-00-10')).toBe('Please enter a valid date');
  });

  it('accepts Feb 29 in a real leap year', () => {
    freezeLocalDate(2026, 9, 13);
    expect(dateOfBirthError('2024-02-29')).toBeUndefined();
  });
});
