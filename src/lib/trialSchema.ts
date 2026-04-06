// Minimal Drizzle schema for kiosk trial signup queries.
// Mirrors the relevant tables from dojo-planner/src/models/Schema.ts.
// Update this file if the upstream schema changes.

import { boolean, integer, pgTable, primaryKey, real, text, timestamp } from 'drizzle-orm/pg-core';

export const memberTrialSchema = pgTable('member', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  clerkUserId: text('clerk_user_id'),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  email: text('email').notNull(),
  memberType: text('member_type'), // individual, family-member, head-of-household
  phone: text('phone'),
  dateOfBirth: timestamp('date_of_birth', { mode: 'date' }),
  status: text('status').notNull().default('trial'), // active, hold, trial, cancelled, past_due
  statusChangedAt: timestamp('status_changed_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
});

export const addressTrialSchema = pgTable('address', {
  id: text('id').primaryKey(),
  memberId: text('member_id').notNull(),
  type: text('type').notNull().default('home'), // home, billing, mailing
  street: text('street').notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  zipCode: text('zip_code').notNull(),
  country: text('country').notNull().default('US'),
  isDefault: boolean('is_default').default(false),
});

export const programTrialSchema = pgTable('program', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  isActive: boolean('is_active').default(true),
  sortOrder: integer('sort_order').default(0),
});

export const membershipPlanTrialSchema = pgTable('membership_plan', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  programId: text('program_id'),
  name: text('name').notNull(),
  price: real('price').notNull().default(0),
  frequency: text('frequency').notNull().default('Monthly'),
  contractLength: text('contract_length').notNull(),
  isTrial: boolean('is_trial').default(false),
  isActive: boolean('is_active').default(true),
});

export const memberMembershipTrialSchema = pgTable('member_membership', {
  id: text('id').primaryKey(),
  memberId: text('member_id').notNull(),
  membershipPlanId: text('membership_plan_id').notNull(),
  status: text('status').notNull().default('active'), // active, cancelled, expired, converted
  billingType: text('billing_type').notNull().default('one-time'), // autopay, one-time
  startDate: timestamp('start_date', { mode: 'date' }).defaultNow().notNull(),
  endDate: timestamp('end_date', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
});

export const waiverTemplateTrialSchema = pgTable('waiver_template', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  version: integer('version').notNull().default(1),
  content: text('content').notNull(),
  isDefault: boolean('is_default').default(false),
  isActive: boolean('is_active').default(true),
  requiresGuardian: boolean('requires_guardian').default(true),
  guardianAgeThreshold: integer('guardian_age_threshold').default(16),
});

export const waiverMergeFieldTrialSchema = pgTable('waiver_merge_field', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  key: text('key').notNull(),
  defaultValue: text('default_value').notNull(),
});

export const signedWaiverTrialSchema = pgTable('signed_waiver', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  waiverTemplateId: text('waiver_template_id').notNull(),
  waiverTemplateVersion: integer('waiver_template_version').notNull(),
  memberId: text('member_id').notNull(),
  memberMembershipId: text('member_membership_id'),
  membershipPlanName: text('membership_plan_name'),
  membershipPlanPrice: real('membership_plan_price'),
  membershipPlanFrequency: text('membership_plan_frequency'),
  membershipPlanContractLength: text('membership_plan_contract_length'),
  membershipPlanSignupFee: real('membership_plan_signup_fee'),
  membershipPlanIsTrial: boolean('membership_plan_is_trial'),
  signatureDataUrl: text('signature_data_url').notNull(),
  signedByName: text('signed_by_name').notNull(),
  signedByEmail: text('signed_by_email'),
  signedByRelationship: text('signed_by_relationship'), // null = self, 'parent', 'guardian', 'legal_guardian'
  memberFirstName: text('member_first_name').notNull(),
  memberLastName: text('member_last_name').notNull(),
  memberEmail: text('member_email').notNull(),
  memberDateOfBirth: timestamp('member_date_of_birth', { mode: 'date' }),
  memberAgeAtSigning: integer('member_age_at_signing'),
  renderedContent: text('rendered_content').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  signedAt: timestamp('signed_at', { mode: 'date' }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

export const familyMemberTrialSchema = pgTable('family_member', {
  memberId: text('member_id').notNull(),
  relatedMemberId: text('related_member_id').notNull(),
  relationship: text('relationship').notNull(),
}, table => [
  primaryKey({ columns: [table.memberId, table.relatedMemberId] }),
]);
