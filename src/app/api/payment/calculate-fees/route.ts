import type { FeeBreakdown } from '@/lib/types';

import { NextResponse } from 'next/server';
import { resolveOrgIdFromRequest } from '@/lib/clerk';
import { computeFeeBreakdown, getGatewayProcessors } from '@/lib/iqpro';
import { getOrganizationServiceFeePct, getOrganizationTaxRate, resolveIQProConfig } from '@/lib/iqproConfig';

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

// IQPro's /calculatefees looks the BIN up in their database to determine card
// brand/category; an unassigned BIN like `400000` triggers an opaque 500. Use
// the Visa test BIN (4242 4242…) which IQPro recognises as a real issuer.
// ServiceFee is a straight percentage so the returned amount is identical.
const PREVIEW_BIN = '424242';

/**
 * Compute the tax + service fee breakdown for a transaction.
 * - Tax: computed locally from `organization.location_tax_rate` (store items only).
 * - Service fee: computed by IQPro's /calculatefees endpoint (authoritative,
 *   avoids fractional-cent rounding discrepancies).
 */
export async function POST(request: Request) {
  const orgId = await resolveOrgIdFromRequest(request);
  if (!orgId) {
    return NextResponse.json<CalculateFeesResponse>(
      { success: false, error: 'Organization not found. Pass ?org=<slug>.' },
      { status: 400 },
    );
  }

  const iqproConfig = await resolveIQProConfig(orgId);
  if (!iqproConfig) {
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
    const processors = await getGatewayProcessors(iqproConfig);
    const processorId = body.paymentMethod === 'card'
      ? processors.cardProcessorId
      : processors.achProcessorId;

    if (!processorId) {
      return NextResponse.json<CalculateFeesResponse>(
        { success: false, error: `No ${body.paymentMethod} processor configured on gateway` },
        { status: 503 },
      );
    }

    const taxStatePct = await getOrganizationTaxRate(orgId);
    const serviceFeePct = await getOrganizationServiceFeePct(orgId);

    const feeBreakdown: FeeBreakdown = await computeFeeBreakdown(
      iqproConfig,
      body.baseAmount,
      body.isTaxable,
      taxStatePct,
      {
        processorId,
        serviceFeePct,
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
