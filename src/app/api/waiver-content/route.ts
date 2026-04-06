import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import {
  membershipWaiver,
  waiverMergeField,
  waiverTemplate,
} from '@/lib/memberSchema';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { planId?: string };
    const orgId = process.env.ORGANIZATION_ID;

    if (!orgId) {
      return NextResponse.json({ error: 'ORGANIZATION_ID is not configured' }, { status: 500 });
    }

    const db = getDatabase();

    // If a planId is provided, look up the waiver template linked to that plan
    let template: typeof waiverTemplate.$inferSelect | undefined;

    if (body.planId) {
      const linked = await db
        .select({ waiverTemplateId: membershipWaiver.waiverTemplateId })
        .from(membershipWaiver)
        .where(eq(membershipWaiver.membershipPlanId, body.planId))
        .limit(1);

      if (linked[0]) {
        const templates = await db
          .select()
          .from(waiverTemplate)
          .where(
            and(
              eq(waiverTemplate.id, linked[0].waiverTemplateId),
              eq(waiverTemplate.isActive, true),
            ),
          )
          .orderBy(desc(waiverTemplate.version))
          .limit(1);

        template = templates[0];
      }
    }

    // Fallback: default active waiver template for the org
    if (!template) {
      const defaults = await db
        .select()
        .from(waiverTemplate)
        .where(
          and(
            eq(waiverTemplate.organizationId, orgId),
            eq(waiverTemplate.isDefault, true),
            eq(waiverTemplate.isActive, true),
          ),
        )
        .orderBy(desc(waiverTemplate.version))
        .limit(1);

      template = defaults[0];
    }

    // Final fallback: any active waiver template for the org
    if (!template) {
      const any = await db
        .select()
        .from(waiverTemplate)
        .where(
          and(
            eq(waiverTemplate.organizationId, orgId),
            eq(waiverTemplate.isActive, true),
          ),
        )
        .orderBy(desc(waiverTemplate.version))
        .limit(1);

      template = any[0];
    }

    if (!template) {
      return NextResponse.json({ found: false, content: '', templateName: '' });
    }

    // Fetch merge fields and substitute <key> placeholders
    const mergeFields = await db
      .select()
      .from(waiverMergeField)
      .where(eq(waiverMergeField.organizationId, orgId));

    let renderedContent = template.content;
    for (const field of mergeFields) {
      renderedContent = renderedContent.split(`<${field.key}>`).join(field.defaultValue);
    }

    return NextResponse.json({
      found: true,
      content: renderedContent,
      templateName: template.name,
      templateId: template.id,
      templateVersion: template.version,
    });
  }
  catch (error) {
    console.error('POST /api/waiver-content error:', error);
    return NextResponse.json({ error: 'Failed to load waiver content' }, { status: 500 });
  }
}
