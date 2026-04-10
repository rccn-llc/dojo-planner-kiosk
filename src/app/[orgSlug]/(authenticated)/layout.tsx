import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyMemberSession } from '@/lib/memberSession';

interface AuthenticatedLayoutProps {
  children: ReactNode;
  params: Promise<{ orgSlug: string }>;
}

export default async function AuthenticatedLayout({ children, params }: AuthenticatedLayoutProps) {
  const { orgSlug } = await params;

  // In development, skip session check
  if (process.env.NODE_ENV === 'development') {
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

  return <>{children}</>;
}
