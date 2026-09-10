'use client';

import type { TokenizeResult } from './useTokenExIframe';
import type { ClientTokenizationConfig } from '@/types/tokenization';

import { useSquareCard } from './useSquareCard';
import { useTokenExIframe } from './useTokenExIframe';

/**
 * One card-collection interface over both providers. A port of dojo-planner's
 * hook of the same name; keep the two in step.
 *
 * ⚠️ BOTH hooks are called on every render — rules of hooks forbid choosing
 * one. The non-selected hook receives `config: null`, which each treats as "not
 * my provider, do nothing": no script injected, no widget mounted.
 */

/**
 * `split`   — IQPro: separate PAN and CVV iframes, plus our own expiry input.
 * `unified` — Square: one widget owning number, expiry and CVV together.
 *
 * Flows branch on THIS rather than on the provider name.
 */
export type CardFormLayout = 'split' | 'unified';

interface UseCardTokenizerOptions {
  /** PAN container for IQPro; the whole widget's container for Square. */
  containerId: string;
  /** Ignored when the provider is Square, which has no separate CVV field. */
  cvvContainerId?: string;
  config: ClientTokenizationConfig | null;
}

interface UseCardTokenizerReturn {
  isLoaded: boolean;
  isValid: boolean;
  isCvvValid: boolean;
  error: string | null;
  tokenize: () => Promise<TokenizeResult>;
  layout: CardFormLayout;
  provider: 'iqpro' | 'square' | null;
  /** Square only: background for its injected `.sq-card-iframe-container`. */
  backgroundColor: string | null;
}

export function useCardTokenizer({
  containerId,
  cvvContainerId,
  config,
}: UseCardTokenizerOptions): UseCardTokenizerReturn {
  const isSquare = config?.provider === 'square';

  const tokenEx = useTokenExIframe({
    containerId,
    cvvContainerId,
    config: config?.provider === 'iqpro' ? config.iqpro : null,
  });

  const square = useSquareCard({
    containerId,
    config: isSquare ? config.square : null,
  });

  if (isSquare) {
    return {
      isLoaded: square.isLoaded,
      isValid: square.isValid,
      // Mirrors isValid rather than being hardcoded true: Square's single
      // widget does not report valid until its CVV is complete.
      isCvvValid: square.isValid,
      error: square.error,
      tokenize: square.tokenize,
      layout: 'unified',
      provider: 'square',
      backgroundColor: square.backgroundColor,
    };
  }

  return {
    ...tokenEx,
    layout: 'split',
    provider: config ? 'iqpro' : null,
    backgroundColor: null,
  };
}
