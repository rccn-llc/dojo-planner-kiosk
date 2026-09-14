'use client';

interface IdleWarningProps {
  /** Whole seconds left before the session resets, or null to render nothing. */
  secondsRemaining: number | null;
  /** Dismiss the warning and restart the idle window. */
  onStay: () => void;
}

/**
 * "Are you still there?" overlay shown in the last seconds before a kiosk
 * session times out and wipes whatever the previous person typed.
 *
 * Deliberately an overlay rather than an inline banner: the kiosk is unattended
 * and the person is often looking away, so this needs to be the thing on screen
 * when they look back, not a strip they scroll past.
 */
export function IdleWarning({ secondsRemaining, onStay }: IdleWarningProps) {
  if (secondsRemaining === null) {
    return null;
  }

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="Session about to expire"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-lg rounded-3xl border-2 border-black bg-white p-8 text-center shadow-2xl sm:p-10">
        <h2 className="mb-3 text-2xl font-bold text-black sm:text-3xl">Are you still there?</h2>
        <p className="mb-2 text-lg text-gray-600">
          For your privacy, this session will reset in
        </p>
        <p className="mb-8 text-5xl font-bold text-orange-600 tabular-nums">
          {secondsRemaining}
          <span className="ml-2 text-2xl font-normal text-gray-500">
            {secondsRemaining === 1 ? 'second' : 'seconds'}
          </span>
        </p>
        <button
          type="button"
          onClick={onStay}
          className="min-h-16 w-full cursor-pointer rounded-2xl border-2 border-black bg-black px-12 py-4 text-xl font-bold text-white transition-colors hover:bg-gray-800"
        >
          I'm still here
        </button>
      </div>
    </div>
  );
}
