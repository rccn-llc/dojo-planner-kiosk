// Drizzle schema for member-related tables.
// Mirrors the relevant tables from dojo-planner/src/models/Schema.ts.

import { boolean, index, integer, pgTable, primaryKey, real, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// Member table
export const member = pgTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    clerkUserId: text('clerk_user_id'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email').notNull(),
    memberType: text('member_type'),
    phone: text('phone'),
    dateOfBirth: timestamp('date_of_birth', { mode: 'date' }),
    status: text('status').notNull().default('active'),
    statusChangedAt: timestamp('status_changed_at', { mode: 'date' }),
    iqproCustomerId: text('iqpro_customer_id'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    index('member_org_idx').on(table.organizationId),
    index('member_org_status_idx').on(table.organizationId, table.status),
    index('member_org_email_idx').on(table.organizationId, table.email),
    uniqueIndex('member_clerk_user_idx').on(table.clerkUserId),
    uniqueIndex('member_iqpro_customer_idx').on(table.iqproCustomerId),
  ],
);

// Address table
export const address = pgTable('address', {
  id: text('id').primaryKey(),
  memberId: text('member_id').notNull(),
  type: text('type').notNull().default('home'),
  street: text('street').notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  zipCode: text('zip_code').notNull(),
  country: text('country').notNull().default('US'),
  isDefault: boolean('is_default').default(false),
});

// Family member link table
export const familyMember = pgTable('family_member', {
  memberId: text('member_id').notNull(),
  relatedMemberId: text('related_member_id').notNull(),
  relationship: text('relationship').notNull(),
}, table => [
  primaryKey({ columns: [table.memberId, table.relatedMemberId] }),
]);

// Member membership table
export const memberMembership = pgTable(
  'member_membership',
  {
    id: text('id').primaryKey(),
    memberId: text('member_id').notNull(),
    membershipPlanId: text('membership_plan_id').notNull(),
    status: text('status').notNull().default('active'),
    billingType: text('billing_type').notNull().default('autopay'),
    startDate: timestamp('start_date', { mode: 'date' }).defaultNow().notNull(),
    endDate: timestamp('end_date', { mode: 'date' }),
    nextPaymentDate: timestamp('next_payment_date', { mode: 'date' }),
    iqproSubscriptionId: text('iqpro_subscription_id'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    index('member_membership_member_idx').on(table.memberId),
    index('member_membership_member_status_idx').on(table.memberId, table.status),
  ],
);

// Program table
// Used by classes/today route for program-based access filtering
export const program = pgTable(
  'program',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    isActive: boolean('is_active').default(true),
    sortOrder: integer('sort_order').default(0),
  },
  table => [
    index('program_org_idx').on(table.organizationId),
  ],
);

// Membership plan table
export const membershipPlan = pgTable(
  'membership_plan',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    programId: text('program_id'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    category: text('category').notNull(),
    program: text('program').notNull(),
    price: real('price').notNull().default(0),
    signupFee: real('signup_fee').notNull().default(0),
    cancellationFee: real('cancellation_fee').notNull().default(0),
    frequency: text('frequency').notNull().default('Monthly'),
    contractLength: text('contract_length').notNull(),
    accessLevel: text('access_level').notNull(),
    description: text('description'),
    isTrial: boolean('is_trial').default(false),
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    index('membership_plan_org_idx').on(table.organizationId),
    index('membership_plan_program_idx').on(table.programId),
  ],
);

// Coupon table
export const coupon = pgTable(
  'coupon',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    discountType: text('discount_type').notNull(),
    discountValue: real('discount_value').notNull(),
    applicableTo: text('applicable_to').notNull(),
    minPurchaseAmount: real('min_purchase_amount'),
    maxDiscountAmount: real('max_discount_amount'),
    usageLimit: integer('usage_limit'),
    usageCount: integer('usage_count').default(0),
    perUserLimit: integer('per_user_limit').default(1),
    validFrom: timestamp('valid_from', { mode: 'date' }).defaultNow().notNull(),
    validUntil: timestamp('valid_until', { mode: 'date' }),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    index('coupon_org_idx').on(table.organizationId),
    uniqueIndex('coupon_org_code_idx').on(table.organizationId, table.code),
    index('coupon_status_idx').on(table.status),
  ],
);

// Waiver template table
export const waiverTemplate = pgTable(
  'waiver_template',
  {
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
  },
  table => [
    index('waiver_template_org_idx').on(table.organizationId),
  ],
);

// Waiver merge field table
export const waiverMergeField = pgTable(
  'waiver_merge_field',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    defaultValue: text('default_value').notNull(),
  },
  table => [
    index('waiver_merge_field_org_idx').on(table.organizationId),
  ],
);

// Membership waiver (linking waiver templates to plans)
export const membershipWaiver = pgTable('membership_waiver', {
  id: text('id').primaryKey(),
  membershipPlanId: text('membership_plan_id').notNull(),
  waiverTemplateId: text('waiver_template_id').notNull(),
});

// Signed waiver table
export const signedWaiver = pgTable(
  'signed_waiver',
  {
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
    signedByRelationship: text('signed_by_relationship'),
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
  },
  table => [
    index('signed_waiver_org_idx').on(table.organizationId),
    index('signed_waiver_member_idx').on(table.memberId),
    index('signed_waiver_template_idx').on(table.waiverTemplateId),
    index('signed_waiver_membership_idx').on(table.memberMembershipId),
  ],
);

// Transaction table
export const transaction = pgTable(
  'transaction',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    memberId: text('member_id').notNull(),
    memberMembershipId: text('member_membership_id'),
    transactionType: text('transaction_type').notNull(),
    amount: real('amount').notNull(),
    currency: text('currency').notNull().default('USD'),
    status: text('status').notNull().default('pending'),
    paymentMethod: text('payment_method'),
    description: text('description'),
    iqproTransactionId: text('iqpro_transaction_id'),
    processedAt: timestamp('processed_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    index('transaction_org_idx').on(table.organizationId),
    index('transaction_member_idx').on(table.memberId),
    index('transaction_status_idx').on(table.status),
    index('transaction_date_idx').on(table.createdAt),
  ],
);

// Class table (dojo_class would conflict — using 'class' table name)
export const dojoClass = pgTable(
  'class',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    programId: text('program_id'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    color: text('color'),
    defaultDurationMinutes: integer('default_duration_minutes').default(60),
    maxCapacity: integer('max_capacity'),
    minAge: integer('min_age'),
    maxAge: integer('max_age'),
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    index('class_org_idx').on(table.organizationId),
    index('class_program_idx').on(table.programId),
  ],
);

// Class schedule instance table
export const classScheduleInstance = pgTable(
  'class_schedule_instance',
  {
    id: text('id').primaryKey(),
    classId: text('class_id').notNull(),
    primaryInstructorClerkId: text('primary_instructor_clerk_id'),
    dayOfWeek: integer('day_of_week').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    room: text('room'),
    effectiveFrom: timestamp('effective_from', { mode: 'date' }).defaultNow().notNull(),
    effectiveUntil: timestamp('effective_until', { mode: 'date' }),
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    index('class_schedule_class_idx').on(table.classId),
    index('class_schedule_day_idx').on(table.dayOfWeek),
  ],
);

// Attendance table
export const attendance = pgTable(
  'attendance',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    memberId: text('member_id').notNull(),
    classScheduleInstanceId: text('class_schedule_instance_id'),
    attendanceDate: timestamp('attendance_date', { mode: 'date' }).notNull(),
    checkInTime: timestamp('check_in_time', { mode: 'date' }).defaultNow().notNull(),
    checkOutTime: timestamp('check_out_time', { mode: 'date' }),
    checkInMethod: text('check_in_method').notNull().default('manual'),
    notes: text('notes'),
  },
  table => [
    index('attendance_org_idx').on(table.organizationId),
    index('attendance_member_idx').on(table.memberId),
    index('attendance_date_idx').on(table.attendanceDate),
    index('attendance_schedule_idx').on(table.classScheduleInstanceId),
  ],
);
