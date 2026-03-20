import { NextResponse } from 'next/server';
import { getTokenizationConfig, isIQProConfigured } from '@/lib/iqpro';

/**
 * GET /api/payment/tokenization-config
 *
 * Returns the TokenEx iframe configuration needed to initialize the card
 * entry iframe on the client. The `origin` header from the request is
 * forwarded to IQPro so the tokenization context is scoped to this kiosk's
 * origin.
 */
export async function GET(request: Request) {
  if (!isIQProConfigured()) {
    return NextResponse.json(
      { error: 'Payment processing is not configured' },
      { status: 503 },
    );
  }

  try {
    const clientOrigin = request.headers.get('origin') ?? new URL(request.url).origin;
    const config = await getTokenizationConfig(clientOrigin);

    if (!config) {
      return NextResponse.json(
        { error: 'Failed to fetch tokenization config' },
        { status: 500 },
      );
    }

    return NextResponse.json({ config });
  }
  catch (error) {
    console.error('[tokenization-config] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tokenization config' },
      { status: 500 },
    );
  }
}
