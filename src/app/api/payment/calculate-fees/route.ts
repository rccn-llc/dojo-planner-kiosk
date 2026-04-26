import type { FeeBreakdown } from '@/lib/types';

import { NextResponse } from 'next/server';
import { computeFeeBreakdown, getGatewayProcessors, isIQProConfigured } from '@/lib/iqpro';

export interface CalculateFeesRequest {
  baseAmount: number;
  isTaxable: boolean;
  paymentMethod: 'card' | 'ach';
  // Optional: if the card has already been tokenized, pass the token for the
  // most accurate calculation. Otherwise we fall back to a Visa-credit BIN
  // placeholder (the service-fee rate is card-brand-independent, so the
  // computed flatAmount is identical regardless).
  token?: string;
  creditCardBin?: string;
}

export interface CalculateFeesResponse {
  success: boolean;
  feeBreakdown?: FeeBreakdown;
  error?: string;
}

const PREVIEW_BIN = '400000';

/**
 * Compute the tax + service fee breakdown for a transaction.
 * - Tax: computed locally from KIOSK_TAX_STATE_PCT (store items only).
 * - Service fee: computed by IQPro's /calculatefees endpoint (authoritative,
 *   avoids fractional-cent rounding discrepancies).
 */
export async function POST(request: Request) {
  if (!isIQProConfigured()) {
    return NextResponse.json<CalculateFeesResponse>(
      { success: false, error: 'Payment processing is not configured' },
      { status: 503 },
    );
  }

  let body: CalculateFeesRequest;
  try {
    body = await request.json() as CalculateFeesRequest;
  }
  catch {
    return NextResponse.json<CalculateFeesResponse>(
      { success: false, error: 'Invalid request body' },
      { status: 400 },
    );
  }

  if (typeof body.baseAmount !== 'number' || body.baseAmount <= 0) {
    return NextResponse.json<CalculateFeesResponse>(
      { success: false, error: 'baseAmount must be a positive number' },
      { status: 400 },
    );
  }
  if (typeof body.isTaxable !== 'boolean') {
    return NextResponse.json<CalculateFeesResponse>(
      { success: false, error: 'isTaxable must be a boolean' },
      { status: 400 },
    );
  }
  if (body.paymentMethod !== 'card' && body.paymentMethod !== 'ach') {
    return NextResponse.json<CalculateFeesResponse>(
      { success: false, error: 'paymentMethod must be "card" or "ach"' },
      { status: 400 },
    );
  }

  try {
    const processors = await getGatewayProcessors();
    const processorId = body.paymentMethod === 'card'
      ? processors.cardProcessorId
      : processors.achProcessorId;

    if (!processorId) {
      return NextResponse.json<CalculateFeesResponse>(
        { success: false, error: `No ${body.paymentMethod} processor configured on gateway` },
        { status: 503 },
      );
    }

    const feeBreakdown: FeeBreakdown = await computeFeeBreakdown(
      body.baseAmount,
      body.isTaxable,
      {
        processorId,
        token: body.token,
        // IQPro's /calculatefees requires "exactly one" of token or BIN.
        // When no token is available (ACH always, or card before tokenization),
        // send a Visa-credit placeholder BIN — ServiceFee is a straight
        // percentage so the returned amount is identical regardless.
        creditCardBin: body.token
          ? undefined
          : (body.creditCardBin ?? PREVIEW_BIN),
      },
    );

    return NextResponse.json<CalculateFeesResponse>({ success: true, feeBreakdown });
  }
  catch (err) {
    console.error('[payment/calculate-fees] failed:', err);
    return NextResponse.json<CalculateFeesResponse>(
      { success: false, error: err instanceof Error ? err.message : 'Fee calculation failed' },
      { status: 500 },
    );
  }
}
