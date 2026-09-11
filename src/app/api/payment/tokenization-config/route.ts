import { NextResponse } from 'next/server';
import { resolveOrgIdFromRequest } from '@/lib/clerk';
import { getTokenizationConfig } from '@/lib/iqpro';
import { resolveIQProConfig, resolveSquareCardConfig } from '@/lib/iqproConfig';

/**
 * GET /api/payment/tokenization-config?org=<slug>
 *
 * Returns what the client needs to collect a card, as a discriminated union on
 * `provider`. IQPro hosts a TokenEx iframe (whose context is scoped to this
 * kiosk's `origin`); Square runs its own Web Payments SDK and needs only its
 * application/location ids. Credentials are resolved per-org from `?org=`.
 */
export async function GET(request: Request) {
  try {
    const orgId = await resolveOrgIdFromRequest(request);
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organization not found. Pass ?org=<slug>.' },
        { status: 400 },
      );
    }

    // Square first: a Square org has a null IQPro config by construction, so
    // checking IQPro first would 503 it.
    const squareConfig = await resolveSquareCardConfig(orgId);
    if (squareConfig) {
      return NextResponse.json({ config: { provider: 'square', square: squareConfig } });
    }

    const iqproConfig = await resolveIQProConfig(orgId);
    if (!iqproConfig) {
      return NextResponse.json(
        { error: 'Payment processing is not configured' },
        { status: 503 },
      );
    }

    const clientOrigin = request.headers.get('origin') ?? new URL(request.url).origin;
    const tokenizationConfig = await getTokenizationConfig(iqproConfig, clientOrigin);

    if (!tokenizationConfig) {
      return NextResponse.json(
        { error: 'Failed to fetch tokenization config' },
        { status: 500 },
      );
    }

    return NextResponse.json({ config: { provider: 'iqpro', iqpro: tokenizationConfig } });
  }
  catch (error) {
    console.error('[tokenization-config] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tokenization config' },
      { status: 500 },
    );
  }
}
