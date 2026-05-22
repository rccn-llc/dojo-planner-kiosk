'use client';

import { usePathname, useSearchParams } from 'next/navigation';

const RESERVED_FIRST_SEGMENTS = new Set(['api', '_next', 'favicon.ico']);

/**
 * Resolve the Clerk org slug from the current URL.
 *
 * The kiosk is served per-org under `/<orgSlug>/...`. This hook reads
 * `usePathname()` and returns the first non-reserved path segment. As a
 * fallback it accepts `?org=<slug-or-org-id>` from the query string (useful
 * for local dev and debugging), then `NEXT_PUBLIC_DEFAULT_ORG_SLUG`.
 *
 * Returns `null` when no slug can be derived.
 */
export function useOrgSlug(): string | null {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (pathname) {
    const first = pathname.split('/').filter(Boolean)[0];
    if (first && !RESERVED_FIRST_SEGMENTS.has(first)) {
      return first;
    }
  }

  const fromQuery = searchParams.get('org')?.trim();
  if (fromQuery) {
    return fromQuery;
  }

  return process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ?? null;
}

/**
 * Append `?org=<slug>` to a payment-API path. Returns the path unchanged when
 * `slug` is null so caller errors surface as a 400 from the API rather than a
 * silent malformed request.
 */
export function withOrgQuery(path: string, slug: string | null): string {
  if (!slug) {
    return path;
  }
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}org=${encodeURIComponent(slug)}`;
}
