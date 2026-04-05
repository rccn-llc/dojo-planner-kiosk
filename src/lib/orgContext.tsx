'use client';

import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { OrgContext } from './useOrgContext';

interface OrgContextValue {
  orgId: string;
  orgName: string;
  orgSlug: string;
}

interface OrgProviderProps {
  children: ReactNode;
  orgId: string;
  orgName: string;
  orgSlug: string;
}

export function OrgProvider({ children, orgId, orgName, orgSlug }: OrgProviderProps) {
  const value = useMemo<OrgContextValue>(
    () => ({ orgId, orgName, orgSlug }),
    [orgId, orgName, orgSlug],
  );

  return (
    <OrgContext value={value}>
      {children}
    </OrgContext>
  );
}
