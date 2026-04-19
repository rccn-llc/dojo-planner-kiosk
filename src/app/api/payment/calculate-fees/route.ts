import type { FeeBreakdown } from '@/lib/types';

import { NextResponse } from 'next/server';
import { calculateTransactionFees, getGatewayProcessors, getKioskTaxState, isIQProConfigured } from '@/lib/iqpro';

export interface CalculateFeesRequest {
  baseAmount: number;
  paymentMethod: 'card' | 'ach';
  creditCardBin?: string;
  token?: string;
}

export interface CalculateFeesResponse {
  success: boolean;
  feeBreakdown?: FeeBreakdown;
  error?: string;
}

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

    const result = await calculateTransactionFees({
      baseAmount: Math.round(body.baseAmount * 100) / 100,
      processorId,
      state: getKioskTaxState(),
      paymentMethod: body.paymentMethod,
      creditCardBin: body.creditCardBin,
      token: body.token,
    });

    const feeBreakdown: FeeBreakdown = {
      baseAmount: result.baseAmount,
      surchargeAmount: result.surchargeAmount,
      serviceFeesAmount: result.serviceFeesAmount,
      convenienceFeesAmount: result.convenienceFeesAmount,
      taxAmount: result.taxAmount,
      amount: result.amount,
      isSurchargeable: result.isSurchargeable,
      cardBrand: result.cardBrand,
      cardType: result.cardType,
    };

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
