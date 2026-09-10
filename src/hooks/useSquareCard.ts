'use client';

import type { TokenizeResult } from './useTokenExIframe';
import type { SquareCardConfig } from '@/lib/iqproConfig';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Square's Web Payments SDK. A port of dojo-planner's hook of the same name;
 * keep the two in step — the kiosk is light-mode only, which is the only
 * intended difference.
 *
 * Mirrors `useTokenExIframe` so the two read
 * alike: local `window` cast rather than `declare global`, injected script,
 * promise-ref tokenize bridge, cleanup on unmount.
 *
 * ── Where it necessarily differs from TokenEx ───────────────────────────────
 *
 * - **One widget, not two.** Square renders number + expiry + CVV into a
 *   SINGLE container, so there is no `cvvContainerId` and no separate expiry
 *   input. Callers read `layout` off `useCardTokenizer` to render accordingly.
 * - **No BIN.** `tokenize()` returns only a nonce. IQPro needs `firstSix` /
 *   `lastFour` to build its `maskedCard`; Square reads `last_4` off its own
 *   `POST /v2/cards` response server-side, so the client returns neither.
 * - **The script URL is per-environment**, so it cannot be a static tag in the
 *   layout — it is chosen here from the org's resolved config.
 */

interface SquareCardInstance {
  /**
   * Re-measures the widget's INNER layout. Needed because we mount the card
   * while its container is still `invisible` (and, in a dialog, possibly
   * mid-animation), so Square can size `.sq-input-wrapper` against a narrower
   * box than the final one.
   */
  recalculateSize?: () => Promise<void>;
  attach: (selector: string) => Promise<void>;
  detach?: () => Promise<void>;
  destroy?: () => Promise<void>;
  tokenize: () => Promise<SquareTokenResult>;
  addEventListener?: (event: string, callback: (ev: unknown) => void) => void;
  removeEventListener?: (event: string, callback: (ev: unknown) => void) => void;
}

interface SquarePayments {
  card: (options?: { style?: Record<string, Record<string, string>> }) => Promise<SquareCardInstance>;
}

interface SquareGlobal {
  payments: (applicationId: string, locationId: string) => SquarePayments;
}

interface SquareTokenResult {
  status: string;
  token?: string;
  errors?: Array<{ message?: string; field?: string }>;
}

interface UseSquareCardOptions {
  containerId: string;
  config: SquareCardConfig | null;
  theme?: 'light' | 'dark';
  /**
   * How long to let the iframe paint before revealing it. Exposed so tests can
   * collapse the wait; production callers use the default.
   */
  revealDelayMs?: number;
  /**
   * How long to wait for the container to appear. Exposed only so tests need
   * not sit through the real timeout; callers should use the default.
   */
  containerTimeoutMs?: number;
}

interface UseSquareCardReturn {
  isLoaded: boolean;
  isValid: boolean;
  error: string | null;
  tokenize: () => Promise<TokenizeResult>;
  /**
   * The resolved input background, for the caller to paint onto Square's
   * injected `.sq-card-iframe-container`. Not settable through the SDK's own
   * style object — some builds reject `backgroundColor` on `.input-container`
   * and refuse the entire object.
   */
  backgroundColor: string | null;
}

/**
 * Resolve once the container exists, or null if it never shows up.
 *
 * Polls on animation frames rather than a fixed timeout so it settles on the
 * very next paint in the normal case.
 */
async function waitForElement(
  id: string,
  isCancelled: () => boolean,
  timeoutMs = 5000,
): Promise<HTMLElement | null> {
  const existing = document.getElementById(id);
  if (existing) {
    return existing;
  }

  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      // Stop the moment the effect is torn down, so an unmounted hook cannot
      // keep a rAF loop alive and later latch onto some other component's
      // container.
      if (isCancelled()) {
        resolve(null);
        return;
      }
      const el = document.getElementById(id);
      if (el) {
        resolve(el);
        return;
      }
      if (Date.now() > deadline) {
        resolve(null);
        return;
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
}

/**
 * Wait for `window.Square` to appear, for the case where the script tag is
 * already in the DOM but has not finished evaluating.
 */
async function waitForGlobal(isCancelled: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(window as unknown as { Square?: unknown }).Square) {
    if (isCancelled() || Date.now() > deadline) {
      return;
    }
    await new Promise((r) => {
      requestAnimationFrame(() => r(null));
    });
  }
}

/**
 * Read the app's own input colours off a REAL input already on the page.
 *
 * Two earlier approaches failed and are worth not repeating:
 *
 * 1. Hardcoded hexes — the tokens are composited `oklch(... / 15%)`, so the
 *    dark values were guesses and came out wrong.
 * 2. A synthetic probe element carrying `<Input>`'s class list — Tailwind's JIT
 *    only compiles classes it can see in source, and a runtime string is
 *    invisible to it, so the probe rendered unstyled and reported light
 *    colours in dark mode.
 *
 * Measuring a real, already-styled sibling input avoids both. It sits in the
 * same form and the same `.dark` scope, so its computed colours are exactly
 * what the field above the card is showing.
 *
 * Falls back to the container's own inherited colours when no sibling input
 * exists (the Edit Payment Method modal can render the card field alone).
 */
function readInputPalette(container: HTMLElement, theme: 'light' | 'dark') {
  // Walk OUT from the container until we find a subtree containing a real
  // text input. These wizards render no <form> element, and the container's
  // immediate parent holds only the card field, so scoping to either finds
  // nothing and we fall back to the container's own (transparent) colours —
  // which is how the widget ended up white with invisible text.
  let scope: HTMLElement | null = container.parentElement;
  let sibling: HTMLInputElement | null = null;
  while (scope && !sibling) {
    sibling = scope.querySelector<HTMLInputElement>(
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])',
    );
    if (!sibling) {
      scope = scope.parentElement;
    }
  }

  // ⚠️ The card container is `display: none` until the widget reports loaded,
  // and an element inside a display:none subtree still computes styles — but
  // only if it is IN THE DOCUMENT. If the walk-out found nothing we would fall
  // back to the container's own transparent background, which paints white.
  // Refuse to guess: report that we could not measure, so the caller can skip
  // the background entirely rather than sending a wrong one.
  if (!sibling) {
    return null;
  }

  const cs = getComputedStyle(sibling);

  const isDark = theme === 'dark';
  return {
    background: cs.backgroundColor,
    // A bare container inherits text colour but has no useful background of
    // its own, so fall back to the theme's foreground rather than reading
    // `transparent` and rendering invisible text.
    color: cs.color,
    borderColor: cs.borderColor,
    placeholder: isDark ? '#a3a3a3' : '#737373',
    destructive: isDark ? '#f87171' : '#dc2626',
    /** Backdrop to composite translucent inputs over. */
    pageBase: isDark ? 'rgb(10, 10, 10)' : 'rgb(255, 255, 255)',
  };
}

/**
 * Any CSS colour -> opaque #rrggbb, composited over `over`.
 *
 * ⚠️ Do NOT parse the string by hand. Modern tokens resolve to `oklch(...)` /
 * `oklab(...)`, whose components are not RGB — a naive regex reads `oklch(0.985
 * 0 0)` as rgb(0.985, 0, 0) and yields near-black, which is how the card text
 * became invisible on a dark background. Canvas does the conversion correctly
 * for every colour space the browser supports.
 */
function toHex(value: string, over: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return over;
  }

  // Paint the backdrop first, then the (possibly translucent) colour over it,
  // so the sampled pixel is the composite the user actually sees.
  ctx.fillStyle = over;
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);

  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map(v => (v ?? 0).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Style the widget to match the app's own inputs.
 *
 * ⚠️ Square validates this object strictly and rejects the WHOLE thing —
 * `InvalidStylesError`, and the card never mounts — if any single entry is
 * unsupported, and WHICH entries are supported varies by SDK build (the `/v1/`
 * URL is a CDN alias that can serve a stale one). So this stays inside the
 * intersection every build accepts:
 *
 * - **6-digit hex only.** `hsl(...)`, `rgb()` and `oklch()` are all rejected.
 * - **One font family**, never a stack.
 * - Only documented properties. There is no padding or height, so the widget
 *   keeps its own vertical rhythm.
 *
 * ⚠️ Square injects `.sq-card-iframe-container` (white) and a
 * `.sq-card-message` row INSIDE our container. The background belongs on the
 * iframe container only — painting our whole container also colours the
 * message row, which reads as a stray bar under the field.
 */
function cardStyleFor(palette: NonNullable<ReturnType<typeof readInputPalette>>) {
  const pageBase = palette.pageBase;
  const background = toHex(palette.background, pageBase);
  const text = toHex(palette.color, pageBase);
  const border = toHex(palette.borderColor, pageBase);

  return {
    // `backgroundColor` on `input` is Square's DOCUMENTED dark-mode hook, and
    // it is the only way to colour the field itself — that input lives inside
    // a cross-origin iframe, so host CSS cannot reach it.
    //
    // ⚠️ It is NOT in the reference's supported-property list (it appears only
    // in an example), and builds disagree: some reject it on
    // `.input-container` and refuse the whole object. So set it HERE only, and
    // keep the host-CSS rule on the outer wrappers as a belt-and-braces for
    // builds that ignore it.
    'input': {
      color: text,
      backgroundColor: background,
      fontSize: '14px',
    },
    // Square applies focus styling separately; without this the field flashes
    // back to its default white the moment the user clicks into it.
    'input.is-focus': {
      color: text,
      backgroundColor: background,
    },
    'input::placeholder': { color: palette.placeholder },
    'input.is-error': { color: palette.destructive },
    // ⚠️ NO backgroundColor here. Some shipped SDK builds accept it on
    // `.input-container`, others reject the whole style object over it — and
    // the `/v1/` URL is a CDN alias, so which one you get is not under our
    // control. The container background is applied from host CSS instead (see
    // the `.sq-card-iframe-container` rule on the component's container),
    // which cannot fail SDK validation.
    '.input-container': {
      borderColor: border,
      borderRadius: '6px',
      borderWidth: '1px',
    },
    '.input-container.is-focus': { borderColor: text },
    '.input-container.is-error': { borderColor: palette.destructive },
    '.message-text': { color: palette.placeholder },
    '.message-text.is-error': { color: palette.destructive },
    '.message-icon': { color: palette.placeholder },
    '.message-icon.is-error': { color: palette.destructive },
  };
}

/**
 * How long to let the Square iframe paint before revealing it. Long enough to
 * cover the styled first paint, short enough not to read as a stall.
 */
const REVEAL_PAINT_DELAY_MS = 120;

/** The SDK is served from a different host per environment. */
function squareSdkUrl(environment: SquareCardConfig['environment']): string {
  return environment === 'production'
    ? 'https://web.squarecdn.com/v1/square.js'
    : 'https://sandbox.web.squarecdn.com/v1/square.js';
}

export function useSquareCard({ containerId, config, theme = 'light', containerTimeoutMs = 5000, revealDelayMs = REVEAL_PAINT_DELAY_MS }: UseSquareCardOptions): UseSquareCardReturn {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backgroundColor, setBackgroundColor] = useState<string | null>(null);
  const cardRef = useRef<SquareCardInstance | null>(null);
  /**
   * Cancels a reveal-wait that is still in flight.
   *
   * Set while the hook waits for the iframe to paint, cleared once it has.
   * Without it an unmount mid-wait leaves a `load` listener, a timer and a
   * queued animation frame behind, all of which would resolve against a
   * component that no longer exists.
   */
  const revealCleanupRef = useRef<(() => void) | null>(null);
  /**
   * Serialises effect runs. React Strict Mode double-invokes effects in dev,
   * so pass 2 would otherwise call `payments.card()` while pass 1's
   * `destroy()` is still in flight — Square's SDK throws a bare
   * `UnexpectedError` on that overlap, with no indication of the cause.
   */
  const initChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    // No config = this provider isn't in use. The facade relies on this to run
    // both hooks unconditionally (rules of hooks) with one of them inert.
    if (!config) {
      return;
    }

    let cancelled = false;
    const scriptUrl = squareSdkUrl(config.environment);
    const onCardError = () => setIsValid(false);
    const onCardValid = () => setIsValid(true);

    const init = async () => {
      // Keyed on the URL, not merely on `window.Square` existing: an org that
      // flips sandbox↔production mid-session would otherwise silently keep
      // using the previously-loaded SDK and tokenize against the wrong
      // environment. Refusing is the safe failure.
      const loadedUrl = document.querySelector<HTMLScriptElement>('script[data-square-sdk]')?.src;
      if (loadedUrl && loadedUrl !== scriptUrl) {
        console.error('[useSquareCard] SDK already loaded for a different environment', { loadedUrl, wanted: scriptUrl });
        setError('Square SDK already loaded for a different environment. Reload the page.');
        return;
      }

      if (!loadedUrl) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = scriptUrl;
          script.async = true;
          script.dataset.squareSdk = 'true';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load the Square payment library.'));
          document.head.appendChild(script);
        });
      }
      else {
        // ⚠️ The tag existing does NOT mean the script has finished executing.
        // On an effect re-run (or a hot reload) we can reach here while
        // `window.Square` is still undefined, so wait for the global rather
        // than assuming a present tag means a ready SDK.
        await waitForGlobal(() => cancelled, containerTimeoutMs);
      }

      if (cancelled) {
        return;
      }

      const square = (window as unknown as { Square?: SquareGlobal }).Square;
      if (!square) {
        console.error('[useSquareCard] script loaded but window.Square is undefined', { scriptUrl });
        setError('Square payment library did not initialize.');
        return;
      }

      // The container is rendered by the same component that calls this hook,
      // so on first mount the effect runs BEFORE the div exists. Waiting for it
      // is what makes that survivable: `useTokenExIframe` can bail and rely on
      // a later run (its `theme` dep changes), but this hook's deps are stable
      // once the config loads, so bailing here would strand the form on
      // "Failed to load secure payment field" with nothing in the console.
      const container = await waitForElement(containerId, () => cancelled, containerTimeoutMs);
      if (cancelled) {
        return;
      }
      if (!container) {
        console.error('[useSquareCard] container never appeared', { containerId });
        setError(`Card form container #${containerId} never appeared.`);
        return;
      }

      const payments = square.payments(config.applicationId, config.locationId);
      const palette = readInputPalette(container, theme);
      // No measurable sibling input: send NO style rather than a guessed one.
      // Square's defaults are at least self-consistent; a half-right palette
      // is what produced white-on-white.
      const style = palette ? cardStyleFor(palette) : undefined;
      // Set --sq-bg on the DOM node DIRECTLY, before the widget mounts.
      //
      // ⚠️ Routing this through React state paints it a render too late: the
      // widget attaches while the variable is still unset, so the container
      // falls back to `transparent` and flashes WHITE until something triggers
      // a re-render (clicking into the field). The state below is kept only so
      // callers can read the value; the variable set here is what the CSS uses.
      const resolvedBackground = palette ? toHex(palette.background, palette.pageBase) : null;
      if (resolvedBackground) {
        container.style.setProperty('--sq-bg', resolvedBackground);
      }
      setBackgroundColor(resolvedBackground);
      const card = await payments.card(style ? { style } : undefined);

      // Checked after BOTH awaits: React Strict Mode double-invokes effects in
      // development, and without this the second pass attaches a second widget.
      if (cancelled) {
        await card.destroy?.().catch(() => {});
        return;
      }

      await card.attach(`#${containerId}`);

      if (cancelled) {
        await card.destroy?.().catch(() => {});
        return;
      }

      cardRef.current = card;

      // ⚠️ `attach()` resolving means the iframe is INSERTED, not that Square
      // has finished styling its contents — measured at ~47ms, well before the
      // embedded document paints. Revealing the container here shows the
      // iframe's own unstyled WHITE document for a beat, which is the flash
      // that made the field look light until it was clicked.
      //
      // The SDK fires no readiness event (verified: none of focusClassAdded,
      // ready, load, rendered et al. ever fire), so there is nothing to await.
      // Wait for the iframe's own `load` instead — that is observable from the
      // parent even though the document is cross-origin — with a frame-based
      // fallback in case it already fired before we could listen.
      // Give the iframe a beat to paint before revealing it.
      //
      // `attach()` resolving means the iframe is INSERTED, not that Square has
      // finished styling its contents (measured at ~47ms), so revealing here
      // shows the embedded document's own unstyled WHITE for a frame — the
      // flash that made the field look light until it was clicked.
      //
      // A timer rather than the iframe's `load` event: measured, `load` has
      // ALWAYS already fired by the time we could attach a listener, so the
      // listener never ran and only created a leak to clean up. The SDK itself
      // fires no readiness event (verified against `ready`, `load`, `rendered`
      // and `focusClassAdded`), so there is nothing better to await.
      await new Promise<void>((resolve) => {
        const timeoutId = setTimeout(resolve, revealDelayMs);
        revealCleanupRef.current = () => {
          clearTimeout(timeoutId);
          resolve();
        };
      });

      revealCleanupRef.current = null;

      if (cancelled) {
        await card.destroy?.().catch(() => {});
        return;
      }

      setIsLoaded(true);

      // Re-measure once the field is actually visible.
      //
      // Square lays out `.sq-input-wrapper` INSIDE its iframe when the widget
      // mounts. We mount it while the container is `invisible` and, in a
      // dialog, possibly mid-animation — so that inner wrapper can be sized
      // against a narrower box than the final one and stay narrow, leaving a
      // strip of the field's right-hand edge unpainted.
      //
      // `recalculateSize()` is the SDK's own hook for this; the inner wrapper
      // is cross-origin, so it is the only way to reach it (a `width` on
      // `.sq-input-wrapper` is rejected outright: "Invalid style selector",
      // and the SDK's style object refuses `width` on any selector).
      requestAnimationFrame(() => {
        void card.recalculateSize?.();
      });

      // Square exposes no single "is the form valid" event equivalent to
      // TokenEx's `validate`. We track the error class it toggles, and treat
      // the form as usable once mounted — `tokenize()` is the real validator
      // and surfaces field errors into the existing declined-card UI.
      setIsValid(true);
      // Listeners on Square's card OBJECT, not on a DOM node. Detached in the
      // cleanup below as well as by destroy(), so a remount cannot accumulate
      // handlers that write to an unmounted component's state.
      card.addEventListener?.('errorClassAdded', onCardError);
      card.addEventListener?.('errorClassRemoved', onCardValid);
    };

    // Chain onto any previous run's teardown rather than racing it.
    initChainRef.current = initChainRef.current.then(init, init);
    initChainRef.current.catch((err: unknown) => {
      // Log as well as surfacing to the UI: the on-screen message is
      // deliberately generic, so without this a failure here is undiagnosable.
      // Square's UnexpectedError hides the real cause behind a generic
      // `message`; the useful detail is on sibling fields.
      console.error('[useSquareCard] initialization failed', err, {
        name: (err as { name?: string })?.name,
        message: (err as { message?: string })?.message,
        detail: (err as { detail?: unknown })?.detail,
        errors: (err as { errors?: unknown })?.errors,
        category: (err as { category?: string })?.category,
        code: (err as { code?: string })?.code,
        keys: err && typeof err === 'object' ? Object.keys(err) : [],
        applicationId: config.applicationId,
        locationId: config.locationId,
        environment: config.environment,
      });
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Failed to initialize the Square card form.');
      }
    });

    return () => {
      cancelled = true;
      revealCleanupRef.current?.();
      revealCleanupRef.current = null;
      const card = cardRef.current;
      cardRef.current = null;
      setIsLoaded(false);
      setIsValid(false);
      setBackgroundColor(null);
      card?.removeEventListener?.('errorClassAdded', onCardError);
      card?.removeEventListener?.('errorClassRemoved', onCardValid);
      // Teardown joins the chain so the NEXT effect run waits for destroy() to
      // finish before creating another card. Failures are swallowed because
      // the component is going away regardless.
      initChainRef.current = initChainRef.current.then(
        () => card?.destroy?.().catch(() => {}) ?? undefined,
        () => card?.destroy?.().catch(() => {}) ?? undefined,
      );
    };
  }, [containerId, config, theme, containerTimeoutMs, revealDelayMs]);

  const tokenize = useCallback(async (): Promise<TokenizeResult> => {
    const card = cardRef.current;
    if (!card) {
      throw new Error('Square card form is not ready.');
    }

    const result = await card.tokenize();

    if (result.status !== 'OK' || !result.token) {
      const detail = result.errors?.map(e => e.message).filter(Boolean).join('; ');
      throw new Error(detail || `Card could not be verified (${result.status}).`);
    }

    // No firstSix/lastFour: Square does not expose the BIN to the browser.
    // Stated explicitly rather than omitted, so the asymmetry is visible.
    return { token: result.token, firstSix: undefined, lastFour: undefined };
  }, []);

  return { isLoaded, isValid, error, tokenize, backgroundColor };
}
