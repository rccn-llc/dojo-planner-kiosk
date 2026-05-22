'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const RESERVED_FIRST_SEGMENTS = new Set(['api', '_next', 'favicon.ico']);

function readPathSlug(pathname: string | null): string | null {
  if (!pathname) {
    return null;
  }
  const first = pathname.split('/').filter(Boolean)[0];
  if (first && !RESERVED_FIRST_SEGMENTS.has(first)) {
    return first;
  }
  return null;
}

/**
 * Resolve the Clerk org slug from the current URL.
 *
 * The kiosk is served per-org under `/<orgSlug>/...`. This hook reads
 * `usePathname()` and returns the first non-reserved path segment. As a
 * fallback it reads `?org=<slug-or-org-id>` from `window.location.search`
 * (read lazily after mount so the page can still be statically prerendered
 * — `useSearchParams` would force a CSR bailout). Finally falls back to
 * `NEXT_PUBLIC_DEFAULT_ORG_SLUG`.
 *
 * Returns `{ slug, resolved }`: `slug` is null until a value is found.
 * `resolved` flips to true once the client-side query check has run, so
 * consumers can show a loading state until then and avoid a guaranteed
 * 400 round-trip when `?org=` is the only source of the slug.
 */
export function useOrgSlug(): { slug: string | null; resolved: boolean } {
  const pathname = usePathname();
  const pathSlug = readPathSlug(pathname);
  const [resolved, setResolved] = useState(pathSlug !== null);
  const [queryOrg, setQueryOrg] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const value = new URLSearchParams(window.location.search).get('org')?.trim();
    if (value) {
      setQueryOrg(value);
    }
    setResolved(true);
  }, []);

  const slug = pathSlug
    ?? queryOrg
    ?? process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG
    ?? null;

  return { slug, resolved };
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
