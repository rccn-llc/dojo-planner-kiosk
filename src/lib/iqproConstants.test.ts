import { describe, expect, it } from 'vitest';
import { IQPRO_BILLING_PERIOD, IQPRO_UNIT, iqproRecurrence } from './iqproConstants';

const start = new Date('2026-04-15T12:00:00Z');

describe('iqproConstants', () => {
  it('ids match IQPro /api/constants (and dojo-planner)', () => {
    expect(IQPRO_BILLING_PERIOD).toEqual({ DAILY: 1, WEEKLY: 2, MONTHLY: 4, YEARLY: 6, SIX_MONTHS: 7 });
    expect(IQPRO_UNIT).toEqual({ DAYS: 36, HALF_YEAR: 69, MONTHS: 120, PIECE: 138, WEEKS: 191, YEARS: 193 });
  });

  it('maps every recurring cadence (case-insensitive)', () => {
    expect(iqproRecurrence('Weekly', start)).toEqual({ billingPeriodId: 2, schedule: { minutes: [0], hours: [0], daysOfWeek: [start.getDay()] }, unitOfMeasureId: 191 });
    expect(iqproRecurrence('monthly', start)).toEqual({ billingPeriodId: 4, schedule: { minutes: [0], hours: [0], daysOfMonth: [15] }, unitOfMeasureId: 120 });
    expect(iqproRecurrence('Semi-Annual', start)).toEqual({ billingPeriodId: 7, schedule: { minutes: [0], hours: [0], daysOfMonth: [15], monthsOfYear: [4, 10] }, unitOfMeasureId: 69 });
    expect(iqproRecurrence('Annual', start)).toEqual({ billingPeriodId: 6, schedule: { minutes: [0], hours: [0], daysOfMonth: [15], monthsOfYear: [4] }, unitOfMeasureId: 193 });
  });

  it('wraps the second semi-annual month and keeps months sorted', () => {
    expect(iqproRecurrence('Semi-Annual', new Date('2026-11-10T12:00:00Z'))!.schedule.monthsOfYear).toEqual([5, 11]);
  });

  it('returns null for anything that is not a recurring cadence', () => {
    for (const f of [null, undefined, '', 'None', 'one-time', 'Daily']) {
      expect(iqproRecurrence(f, start)).toBeNull();
    }
  });
});
