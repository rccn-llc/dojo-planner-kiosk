'use client';

/** Stable module-level default — an inline `[]` would be a new array each render. */
const DEFAULT_IGNORE_KEYS = ['general'];

interface FormErrorSummaryProps {
  errors: Record<string, string> | undefined;
  /**
   * Keys to ignore — e.g. `general`, which the flows render in their own
   * full-screen error state rather than as a field-level problem.
   */
  ignoreKeys?: string[];
  className?: string;
}

/**
 * Banner listing every validation message for the current step.
 *
 * Per-field messages live under their inputs, but on a kiosk the member is
 * often looking at the bottom of the form (the button they just pressed) while
 * the offending field is scrolled off the top. Without this, pressing a
 * blocked submit looks like nothing happened at all.
 */
export function FormErrorSummary({ errors, ignoreKeys = DEFAULT_IGNORE_KEYS, className = '' }: FormErrorSummaryProps) {
  const ignore = new Set(ignoreKeys);
  const messages = Object.entries(errors ?? {})
    .filter(([key, msg]) => !ignore.has(key) && !!msg)
    .map(([, msg]) => msg);

  if (messages.length === 0) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`mb-6 rounded-2xl border-2 border-red-400 bg-red-50 p-4 text-left ${className}`}
    >
      <p className="mb-1 text-lg font-bold text-red-700">
        {messages.length === 1 ? 'Please fix this before continuing:' : 'Please fix these before continuing:'}
      </p>
      <ul className="list-inside list-disc space-y-1">
        {messages.map(msg => (
          <li key={msg} className="text-base text-red-700">{msg}</li>
        ))}
      </ul>
    </div>
  );
}
