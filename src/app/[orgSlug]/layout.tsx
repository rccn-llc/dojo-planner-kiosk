import type { ReactNode } from 'react';
import { resolveOrgBySlug } from '@/lib/clerk';
import { OrgProvider } from '@/lib/orgContext';

interface OrgSlugLayoutProps {
  children: ReactNode;
  params: Promise<{ orgSlug: string }>;
}

export default async function OrgSlugLayout({ children, params }: OrgSlugLayoutProps) {
  const { orgSlug } = await params;

  const org = await resolveOrgBySlug(orgSlug);

  if (!org) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-8">
        <div className="text-center">
          <h1 className="mb-4 text-3xl font-bold text-black">Organization Not Found</h1>
          <p className="text-lg text-gray-500">
            The organization &ldquo;
            {orgSlug}
            &rdquo; could not be found.
          </p>
        </div>
      </div>
    );
  }

  return (
    <OrgProvider orgId={org.orgId} orgName={org.orgName} orgSlug={orgSlug}>
      {children}
    </OrgProvider>
  );
}
