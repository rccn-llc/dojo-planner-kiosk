/**
 * IQPro reference ids, read from IQPro's own `/api/constants/billingperiod` and
 * `/api/constants/units` (sandbox, 2026-10). Mirrors dojo-planner's
 * `libs/IQProConstants.ts`.
 *
 * ⚠️ The unit ids both apps used to send (1 / 3 / 4 / 6, believed to be
 * Item / Month / Year / Week) are Acre / Alcoholic strength by volume / Ampere /
 * Are at IQPro — every existing charge read back as "Acre".
 */

export const IQPRO_BILLING_PERIOD = {
  DAILY: 1,
  WEEKLY: 2,
  MONTHLY: 4,
  YEARLY: 6,
  /** Native semi-annual. IQPro REQUIRES `monthsOfYear` + `daysOfMonth` for it. */
  SIX_MONTHS: 7,
} as const;

export const IQPRO_UNIT = {
  DAYS: 36,
  HALF_YEAR: 69,
  MONTHS: 120,
  /** Generic "each" for one-off Sale line items (fees, store, events). */
  PIECE: 138,
  WEEKS: 191,
  YEARS: 193,
} as const;

/**
 * `subscriptionStatusId`. IQPro has no constants endpoint for these; the names
 * come from the sandbox's own read-backs and validation errors (2026-10).
 *
 * ⚠️ Every subscription both apps created used to send 1 believing it meant
 * Active — it is DRAFT, which never bills. Create with SCHEDULED: IQPro
 * validates the status against the dates and rejects ACTIVE (and TRIALING
 * without a trial) at creation with "status expected is Scheduled"; it moves
 * the subscription on by itself once billing starts.
 */
export const IQPRO_SUBSCRIPTION_STATUS = {
  DRAFT: 1,
  SCHEDULED: 2,
  TRIALING: 3,
  ACTIVE: 4,
  OVERDUE: 5,
  PAUSED: 6,
  CANCELLED: 7,
} as const;

interface IQProRecurrence {
  billingPeriodId: number;
  schedule: Record<string, number[]>;
  /** The line item's unit: one billing period. */
  unitOfMeasureId: number;
}

/**
 * The IQPro recurrence for a plan / hold-fee cadence, or null when the value is
 * not a recurring cadence. Same mapping as dojo-planner's
 * `IQProPaymentService.createSubscription`, so both apps create identical
 * subscriptions.
 *
 * Semi-annual uses IQPro's native Six Months period and lists BOTH months:
 * IQPro requires monthsOfYear for it and does not document whether one month
 * would bill every six months or once a year, so two months fire twice a year
 * either way.
 */
export function iqproRecurrence(frequency: string | null | undefined, startDate: Date): IQProRecurrence | null {
  const dayOfMonth = startDate.getDate();
  const startMonth = startDate.getMonth() + 1;
  const monthly = { minutes: [0], hours: [0], daysOfMonth: [dayOfMonth] };

  switch ((frequency ?? '').trim().toLowerCase()) {
    case 'weekly':
      return {
        billingPeriodId: IQPRO_BILLING_PERIOD.WEEKLY,
        schedule: { minutes: [0], hours: [0], daysOfWeek: [startDate.getDay()] },
        unitOfMeasureId: IQPRO_UNIT.WEEKS,
      };
    case 'monthly':
      return { billingPeriodId: IQPRO_BILLING_PERIOD.MONTHLY, schedule: monthly, unitOfMeasureId: IQPRO_UNIT.MONTHS };
    case 'semi-annual': {
      const secondMonth = ((startMonth - 1 + 6) % 12) + 1;
      return {
        billingPeriodId: IQPRO_BILLING_PERIOD.SIX_MONTHS,
        schedule: { ...monthly, monthsOfYear: [startMonth, secondMonth].sort((a, b) => a - b) },
        unitOfMeasureId: IQPRO_UNIT.HALF_YEAR,
      };
    }
    case 'annual':
      return {
        billingPeriodId: IQPRO_BILLING_PERIOD.YEARLY,
        schedule: { ...monthly, monthsOfYear: [startMonth] },
        unitOfMeasureId: IQPRO_UNIT.YEARS,
      };
    default:
      return null;
  }
}
