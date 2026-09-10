import type { TokenizationIframeConfig } from '@/lib/iqpro';
import type { SquareCardConfig } from '@/lib/iqproConfig';

/**
 * What the kiosk browser needs in order to collect a card, for whichever
 * provider this organization uses.
 *
 * Mirrors `src/types/Tokenization.ts` in dojo-planner. One discriminated union
 * rather than a provider field plus loose credentials: the provider and its
 * credentials are read together, so they cannot disagree and cause a card to be
 * tokenized against the wrong merchant.
 *
 * ⚠️ The Square branch carries ONLY browser-safe fields — never `accessToken`
 * or `webhookSignatureKey`.
 */
export type ClientTokenizationConfig
  = | { provider: 'iqpro'; iqpro: TokenizationIframeConfig }
    | { provider: 'square'; square: SquareCardConfig };
