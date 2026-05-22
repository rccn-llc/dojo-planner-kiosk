import { NextResponse } from 'next/server';
import { resolveOrgIdFromRequest } from '@/lib/clerk';
import { validateDevice } from '@/lib/deviceAuth';

export async function GET(request: Request) {
  // Prefer URL-derived org slug; fall back to device cert / env for legacy callers.
  let orgId = await resolveOrgIdFromRequest(request);
  if (!orgId) {
    const device = await validateDevice(request);
    orgId = device?.orgId ?? process.env.ORGANIZATION_ID ?? null;
  }

  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  if (!orgId) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 400 });
  }
  if (!clerkSecretKey) {
    return NextResponse.json({ error: 'Clerk is not configured' }, { status: 500 });
  }

  try {
    const res = await fetch(`https://api.clerk.com/v1/organizations/${orgId}`, {
      headers: { Authorization: `Bearer ${clerkSecretKey}` },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      return NextResponse.json({ name: null, imageUrl: null }, { status: 200 });
    }

    const org = await res.json() as { name: string; image_url?: string | null; logo_url?: string | null };
    return NextResponse.json({ name: org.name, imageUrl: org.image_url ?? org.logo_url ?? null });
  }
  catch {
    return NextResponse.json({ name: null, imageUrl: null }, { status: 200 });
  }
}
