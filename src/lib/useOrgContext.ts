import { createContext } from 'react';

interface OrgContextValue {
  orgId: string;
  orgName: string;
  orgSlug: string;
}

export const OrgContext = createContext<OrgContextValue | null>(null);
