'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Kiosk session-idle detector.
 *
 * Every flow machine already has a `TIMEOUT` event and a `timeout` state, but
 * nothing was ever firing it — the machines simply waited forever, so a
 * half-filled trial signup (name, phone, address, DOB) sat on screen for the
 * next person to read. This hook is the missing producer.
 *
 * ⚠️ Activity is sampled into a ref and only *read* by the interval tick. The
 * naive version — clearing and re-arming a `setTimeout` inside every listener —
 * re-runs on every `pointermove`, which on a touch kiosk means dozens of timer
 * churns a second while someone signs the waiver. Here the listeners do one
 * cheap ref write and the single interval does the deciding.
 */

/** Idle time before the kiosk gives up on the current session. */
const IDLE_TIMEOUT_MS = 2 * 60 * 1000;

/** How long before the timeout the "are you still there?" warning appears. */
const IDLE_WARNING_MS = 30 * 1000;

/** Events that count as "someone is still using this". */
const ACTIVITY_EVENTS = [
  'pointerdown',
  'pointermove',
  'keydown',
  'wheel',
  'touchstart',
  'touchmove',
] as const;

interface UseIdleTimeoutOptions {
  /** Fired once when the idle window elapses. */
  onTimeout: () => void;
  /**
   * Fired on every tick with the whole seconds left before `onTimeout`, or
   * `null` while the session is not yet inside the warning window.
   */
  onWarn?: (secondsRemaining: number | null) => void;
  /**
   * When false the detector is inert and the countdown is held at the top —
   * used to suspend it on screens where a timeout would be wrong (a payment is
   * in flight, or the flow already finished).
   */
  enabled?: boolean;
  timeoutMs?: number;
  warningMs?: number;
}

export function useIdleTimeout({
  onTimeout,
  onWarn,
  enabled = true,
  timeoutMs = IDLE_TIMEOUT_MS,
  warningMs = IDLE_WARNING_MS,
}: UseIdleTimeoutOptions) {
  // Keep the callbacks in refs so a caller passing inline arrows doesn't tear
  // down and re-attach the listeners on every render.
  const onTimeoutRef = useRef(onTimeout);
  const onWarnRef = useRef(onWarn);
  onTimeoutRef.current = onTimeout;
  onWarnRef.current = onWarn;

  const lastActivityRef = useRef(Date.now());
  const firedRef = useRef(false);
  const warnedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      // Leaving the window "fresh" matters: when the caller re-enables (e.g. a
      // payment finished), the next session starts with a full idle budget
      // rather than instantly timing out on stale activity.
      lastActivityRef.current = Date.now();
      firedRef.current = false;
      warnedAtRef.current = null;
      onWarnRef.current?.(null);
      return;
    }

    const markActive = () => {
      lastActivityRef.current = Date.now();
      firedRef.current = false;
      if (warnedAtRef.current !== null) {
        warnedAtRef.current = null;
        onWarnRef.current?.(null);
      }
    };

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, markActive, { passive: true });
    }

    const interval = window.setInterval(() => {
      if (firedRef.current) {
        return;
      }
      const idleFor = Date.now() - lastActivityRef.current;
      const remainingMs = timeoutMs - idleFor;

      if (remainingMs <= 0) {
        firedRef.current = true;
        warnedAtRef.current = null;
        onWarnRef.current?.(null);
        onTimeoutRef.current();
        return;
      }

      if (remainingMs <= warningMs) {
        const secs = Math.ceil(remainingMs / 1000);
        if (warnedAtRef.current !== secs) {
          warnedAtRef.current = secs;
          onWarnRef.current?.(secs);
        }
      }
    }, 1000);

    return () => {
      window.clearInterval(interval);
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, markActive);
      }
    };
  }, [enabled, timeoutMs, warningMs]);

  /**
   * Reset the idle window by hand — e.g. when the member taps "I'm still here".
   * Stable across renders so callers can safely list it in a dependency array.
   */
  const reset = useCallback(() => {
    lastActivityRef.current = Date.now();
    firedRef.current = false;
    warnedAtRef.current = null;
  }, []);

  return { reset };
}
