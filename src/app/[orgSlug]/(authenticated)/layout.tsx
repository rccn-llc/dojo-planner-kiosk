import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveOrgBySlug } from '@/lib/clerk';
import { verifyMemberSession } from '@/lib/memberSession';

interface AuthenticatedLayoutProps {
  children: ReactNode;
  params: Promise<{ orgSlug: string }>;
}

export default async function AuthenticatedLayout({ children, params }: AuthenticatedLayoutProps) {
  const { orgSlug } = await params;

  // Skip the session check only under the explicit dev-bypass flag AND outside
  // production — mirrors proxy.ts so a mis-set NODE_ENV alone can't disable the
  // gate (a deployed build with NODE_ENV=development would otherwise be open).
  if (process.env.NODE_ENV !== 'production' && process.env.KIOSK_DEV_BYPASS === 'true') {
    return <>{children}</>;
  }

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('member_session');

  if (!sessionCookie?.value) {
    redirect(`/${orgSlug}`);
  }

  const session = await verifyMemberSession(sessionCookie.value);
  if (!session) {
    redirect(`/${orgSlug}`);
  }

  // The session pins an org; ensure it matches the org in the URL so a valid
  // session for org A can't render org B's dashboard chrome.
  const org = await resolveOrgBySlug(orgSlug);
  if (!org || org.orgId !== session.orgId) {
    redirect(`/${orgSlug}`);
  }

  return <>{children}</>;
}
