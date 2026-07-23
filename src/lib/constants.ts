// Shared UI constants used across kiosk flows.

/** USPS two-letter state abbreviations. */
const US_STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
] as const;

/**
 * Pre-built {value,label} options for KioskSelect. Module-level so the array is
 * stable across renders (a per-render `US_STATES.map(...)` would create a new
 * array each keystroke and defeat memoization of the select).
 */
export const US_STATE_OPTIONS = US_STATES.map(s => ({ value: s, label: s }));
