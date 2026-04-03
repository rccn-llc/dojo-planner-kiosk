import { and, asc, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { membershipPlanTrialSchema, programTrialSchema } from '@/lib/trialSchema';

export async function GET() {
  try {
    const db = getDatabase();
    const orgId = process.env.ORGANIZATION_ID;

    if (!orgId) {
      return NextResponse.json({ error: 'ORGANIZATION_ID is not configured' }, { status: 500 });
    }

    // Fetch active programs for this org ordered by sortOrder
    const programs = await db
      .select()
      .from(programTrialSchema)
      .where(
        and(
          eq(programTrialSchema.organizationId, orgId),
          eq(programTrialSchema.isActive, true),
        ),
      )
      .orderBy(asc(programTrialSchema.sortOrder));

    if (programs.length === 0) {
      return NextResponse.json({ programs: [] });
    }

    const programIds = programs.map(p => p.id);

    // Fetch trial plans for these programs sequentially (pglite-server doesn't support parallel connections)
    const trialPlans = await db
      .select()
      .from(membershipPlanTrialSchema)
      .where(
        and(
          inArray(membershipPlanTrialSchema.programId, programIds),
          eq(membershipPlanTrialSchema.isTrial, true),
          eq(membershipPlanTrialSchema.isActive, true),
        ),
      );

    // Group plans by programId
    const plansByProgram = new Map<string, typeof trialPlans>();
    for (const plan of trialPlans) {
      if (!plan.programId) {
        continue;
      }
      const existing = plansByProgram.get(plan.programId) ?? [];
      existing.push(plan);
      plansByProgram.set(plan.programId, existing);
    }

    // Only return programs that have at least one trial plan
    const result = programs
      .filter(p => (plansByProgram.get(p.id)?.length ?? 0) > 0)
      .map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        trialPlans: (plansByProgram.get(p.id) ?? []).map(plan => ({
          id: plan.id,
          name: plan.name,
          contractLength: plan.contractLength,
        })),
      }));

    return NextResponse.json({ programs: result });
  }
  catch (error) {
    console.error('GET /api/trial/programs error:', error);
    return NextResponse.json({ error: 'Failed to load programs' }, { status: 500 });
  }
}
