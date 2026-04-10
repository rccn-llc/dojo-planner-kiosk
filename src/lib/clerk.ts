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
