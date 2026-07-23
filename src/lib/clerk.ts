import type { NextRequest } from 'next/server';
import { createClerkClient } from '@clerk/backend';

interface OrgInfo {
  orgId: string;
  orgName: string;
}

// In-memory cache with 1-hour TTL
const orgCache = new Map<string, { info: OrgInfo; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Resolve an organization by its Clerk slug.
 * Returns the org ID and display name, or null if not found.
 */
export async function resolveOrgBySlug(slug: string): Promise<OrgInfo | null> {
  const cached = orgCache.get(slug);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.info;
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return null;
  }

  try {
    const clerk = createClerkClient({ secretKey });
    const orgList = await clerk.organizations.getOrganizationList({ query: slug, limit: 10 });

    const org = orgList.data.find(
      o => (o.slug ?? '').toLowerCase() === slug.toLowerCase(),
    );

    if (!org) {
      return null;
    }

    const info: OrgInfo = { orgId: org.id, orgName: org.name };
    orgCache.set(slug, { info, expiresAt: Date.now() + CACHE_TTL_MS });
    return info;
  }
  catch (error) {
    console.error('[clerk] Failed to resolve org by slug:', error);
    return null;
  }
}

/**
 * Resolve an organization ID from an incoming request's `?org=<value>` query
 * param. Accepts a Clerk org slug (e.g. `cta-hq`), which is verified against
 * Clerk. A raw Clerk org ID (`org_...`) is accepted *only outside production*
 * as a dev/debug convenience — in production it would let any caller target
 * any org by guessing an ID, bypassing the slug lookup. Returns null when the
 * param is missing or the slug doesn't match.
 */
export async function resolveOrgIdFromRequest(request: NextRequest | Request): Promise<string | null> {
  const url = 'nextUrl' in request ? request.nextUrl : new URL(request.url);
  const value = url.searchParams.get('org')?.trim();
  if (!value) {
    return null;
  }
  if (value.startsWith('org_')) {
    return process.env.NODE_ENV === 'production' ? null : value;
  }
  const org = await resolveOrgBySlug(value);
  return org?.orgId ?? null;
}
