import { NextResponse } from 'next/server';
import { resolveOrgIdFromRequest } from '@/lib/clerk';
import { getTokenizationConfig } from '@/lib/iqpro';
import { resolveIQProConfig } from '@/lib/iqproConfig';

/**
 * GET /api/payment/tokenization-config?org=<slug>
 *
 * Returns the TokenEx iframe configuration needed to initialize the card
 * entry iframe on the client. The `origin` header from the request is
 * forwarded to IQPro so the tokenization context is scoped to this kiosk's
 * origin. IQPro credentials are resolved per-org from the URL's `?org=`.
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

    return NextResponse.json({ config: tokenizationConfig });
  }
  catch (error) {
    console.error('[tokenization-config] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tokenization config' },
      { status: 500 },
    );
  }
}
