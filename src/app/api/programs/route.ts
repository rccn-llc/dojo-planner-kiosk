import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/database';
import { validateDevice } from '@/lib/deviceAuth';
import { membershipPlan, program } from '@/lib/memberSchema';

export async function GET(request: Request) {
  try {
    const device = await validateDevice(request);
    const orgId = device?.orgId ?? process.env.ORGANIZATION_ID;

    if (!orgId) {
      return NextResponse.json({ error: 'Organization context not available' }, { status: 500 });
    }

    const db = getDatabase();

    // Fetch active programs for this org
    const programs = await db
      .select()
      .from(program)
      .where(
        and(
          eq(program.organizationId, orgId),
          eq(program.isActive, true),
        ),
      )
      .orderBy(asc(program.sortOrder));

    // Fetch all active, non-trial membership plans for this org
    const plans = await db
      .select({
        id: membershipPlan.id,
        organizationId: membershipPlan.organizationId,
        programId: membershipPlan.programId,
        name: membershipPlan.name,
        category: membershipPlan.category,
        price: membershipPlan.price,
        frequency: membershipPlan.frequency,
        description: membershipPlan.description,
        isTrial: membershipPlan.isTrial,
        isActive: membershipPlan.isActive,
      })
      .from(membershipPlan)
      .where(
        and(
          eq(membershipPlan.organizationId, orgId),
          eq(membershipPlan.isActive, true),
          eq(membershipPlan.isTrial, false),
        ),
      );

    // Match plans to programs:
    // 1. If plan has programId FK, use that
    // 2. Otherwise, fuzzy-match plan.category against program.name
    const plansByProgram: Record<string, typeof plans> = {};

    for (const plan of plans) {
      let matchedProgramId: string | null = null;

      // Try direct FK first
      if (plan.programId) {
        matchedProgramId = plan.programId;
      }
      else if (plan.category) {
        // Fuzzy match: check if any program name tokens appear in the category
        const catLower = plan.category.toLowerCase();
        for (const p of programs) {
          const nameLower = p.name.toLowerCase();
          // Check if program name is contained in category or vice versa
          const nameTokens = nameLower.split(/[\s-]+/);
          const matched = nameTokens.some(token => token.length > 2 && catLower.includes(token));
          if (matched) {
            matchedProgramId = p.id;
            break;
          }
        }
      }

      if (matchedProgramId) {
        const arr = plansByProgram[matchedProgramId] ?? [];
        arr.push(plan);
        plansByProgram[matchedProgramId] = arr;
      }
    }

    return NextResponse.json({
      programs: programs.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
      })),
      plansByProgram,
    });
  }
  catch (error) {
    console.error('GET /api/programs error:', error);
    return NextResponse.json({ error: 'Failed to load programs' }, { status: 500 });
  }
}
