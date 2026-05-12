import { NextResponse } from 'next/server';
import { validateDevice } from '@/lib/deviceAuth';

export async function GET(request: Request) {
  const device = await validateDevice(request);
  const orgId = device?.orgId ?? process.env.ORGANIZATION_ID;
  const clerkSecretKey = process.env.CLERK_SECRET_KEY;

  if (!orgId || !clerkSecretKey) {
    return NextResponse.json({ name: null, imageUrl: null }, { status: 200 });
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
