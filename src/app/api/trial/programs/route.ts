import { and, asc, eq } from 'drizzle-orm';
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

    // Fetch all active trial plans for this org (not filtered by programId —
    // many plans have program_id = null and are matched via category text)
    const trialPlans = await db
      .select()
      .from(membershipPlanTrialSchema)
      .where(
        and(
          eq(membershipPlanTrialSchema.organizationId, orgId),
          eq(membershipPlanTrialSchema.isTrial, true),
          eq(membershipPlanTrialSchema.isActive, true),
        ),
      );

    // Match plans to programs:
    // 1. If plan has programId FK, use that
    // 2. Otherwise, fuzzy-match plan.category against program.name
    const plansByProgram = new Map<string, typeof trialPlans>();
    for (const plan of trialPlans) {
      let matchedProgramId: string | null = null;

      if (plan.programId) {
        matchedProgramId = plan.programId;
      }
      else if (plan.category) {
        const catLower = plan.category.toLowerCase();
        for (const p of programs) {
          const nameTokens = p.name.toLowerCase().split(/[\s-]+/);
          const matched = nameTokens.some(token => token.length > 2 && catLower.includes(token));
          if (matched) {
            matchedProgramId = p.id;
            break;
          }
        }
      }

      if (matchedProgramId) {
        const existing = plansByProgram.get(matchedProgramId) ?? [];
        existing.push(plan);
        plansByProgram.set(matchedProgramId, existing);
      }
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
