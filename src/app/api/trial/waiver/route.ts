import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { waiverMergeFieldTrialSchema, waiverTemplateTrialSchema } from '@/lib/trialSchema';

export async function GET() {
  try {
    const db = getDatabase();
    const orgId = process.env.ORGANIZATION_ID;

    if (!orgId) {
      return NextResponse.json({ error: 'ORGANIZATION_ID is not configured' }, { status: 500 });
    }

    // Fetch the default active waiver template, newest version first
    const defaultTemplates = await db
      .select()
      .from(waiverTemplateTrialSchema)
      .where(
        and(
          eq(waiverTemplateTrialSchema.organizationId, orgId),
          eq(waiverTemplateTrialSchema.isDefault, true),
          eq(waiverTemplateTrialSchema.isActive, true),
        ),
      )
      .orderBy(desc(waiverTemplateTrialSchema.version))
      .limit(1);

    let template = defaultTemplates[0];

    // Fallback: any active waiver if no default is configured
    if (!template) {
      const fallback = await db
        .select()
        .from(waiverTemplateTrialSchema)
        .where(
          and(
            eq(waiverTemplateTrialSchema.organizationId, orgId),
            eq(waiverTemplateTrialSchema.isActive, true),
          ),
        )
        .orderBy(desc(waiverTemplateTrialSchema.version))
        .limit(1);
      template = fallback[0];
    }

    if (!template) {
      return NextResponse.json({ error: 'No active waiver template found' }, { status: 404 });
    }

    // Fetch merge fields and substitute <key> placeholders with their default values
    const mergeFields = await db
      .select()
      .from(waiverMergeFieldTrialSchema)
      .where(eq(waiverMergeFieldTrialSchema.organizationId, orgId));

    let renderedContent = template.content;
    for (const field of mergeFields) {
      renderedContent = renderedContent.split(`<${field.key}>`).join(field.defaultValue);
    }

    return NextResponse.json({
      id: template.id,
      version: template.version,
      content: renderedContent,
    });
  }
  catch (error) {
    console.error('GET /api/trial/waiver error:', error);
    return NextResponse.json({ error: 'Failed to load waiver' }, { status: 500 });
  }
}
