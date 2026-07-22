// Trial-signup table aliases.
//
// These tables are declared once in `memberSchema.ts` (the single source of
// truth mirroring dojo-planner/src/models/Schema.ts) and re-exported here under
// their historical `*TrialSchema` names so the trial routes keep working.
//
// Do NOT re-declare pgTable() for these tables. Two Drizzle declarations of the
// same physical table drift apart silently — the trial copy of
// `member_membership` was already missing the IQPro subscription columns, so
// which copy a route imported changed whether recurring billing was linked.

export {
  address as addressTrialSchema,
  familyMember as familyMemberTrialSchema,
  memberMembership as memberMembershipTrialSchema,
  membershipPlan as membershipPlanTrialSchema,
  member as memberTrialSchema,
  program as programTrialSchema,
  signedWaiver as signedWaiverTrialSchema,
  waiverMergeField as waiverMergeFieldTrialSchema,
  waiverTemplate as waiverTemplateTrialSchema,
} from './memberSchema';
