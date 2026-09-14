import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { sendSignedWaiver } from '@/lib/email';
import { member, signedWaiver, waiverTemplate } from '@/lib/memberSchema';
import { requireMemberAuth } from '@/lib/requireMemberAuth';
import { getDatabaseForOrg } from '@/lib/tenantDirectory';
import { isValidEmail } from '@/lib/utils';
import { generatePdfFilename, generateWaiverPdfBuffer } from '@/lib/waiverPdf';

/**
 * POST /api/members/:memberId/waivers/:waiverId/send?org=<slug>
 *
 * Email a member a PDF copy of a waiver they have already signed.
 *
 * ⚠️ This route did not exist. `MemberAreaFlow` had always called it, so every
 * press of the "Send" icon next to a waiver hit the Next.js 404 page, and the
 * flow's `res.json()` choked on the HTML — the reported
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`. There was no
 * send-waiver capability at all behind that button.
 *
 * Staff-gated: emailing a waiver mails a document containing the member's
 * signature image and date of birth, so it needs a staff-assisted session
 * rather than any authenticated member session.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ memberId: string; waiverId: string }> },
) {
  try {
    const { memberId, waiverId } = await params;

    const auth = await requireMemberAuth(request, memberId, { requireStaff: true });
    if (!auth.ok) {
      return auth.response;
    }
    const { orgId } = auth;

    const db = await getDatabaseForOrg(orgId);

    // Org-scoped AND member-scoped: the waiver id comes from the client, so
    // neither another org's waiver nor another member's waiver of this org may
    // be fetched by guessing an id.
    const rows = await db
      .select()
      .from(signedWaiver)
      .where(and(
        eq(signedWaiver.id, waiverId),
        eq(signedWaiver.memberId, memberId),
        eq(signedWaiver.organizationId, orgId),
      ))
      .limit(1);

    const waiver = rows[0];
    if (!waiver) {
      return NextResponse.json({ error: 'Waiver not found' }, { status: 404 });
    }

    // Prefer the address on the waiver itself (who actually signed), then the
    // snapshot taken at signing, then the member's current address. A waiver
    // signed by a guardian must reach the guardian.
    const members = await db
      .select({ email: member.email, firstName: member.firstName, lastName: member.lastName })
      .from(member)
      .where(and(eq(member.id, memberId), eq(member.organizationId, orgId)))
      .limit(1);
    const memberRow = members[0];

    const recipient = [waiver.signedByEmail, waiver.memberEmail, memberRow?.email]
      .find(candidate => !!candidate && isValidEmail(candidate));

    if (!recipient) {
      return NextResponse.json(
        { error: 'This member has no email address on file. Add one on the Profile tab first.' },
        { status: 400 },
      );
    }

    // Template name is cosmetic (the PDF heading), so a missing template row
    // must not block the send.
    const templates = await db
      .select({ name: waiverTemplate.name })
      .from(waiverTemplate)
      .where(and(
        eq(waiverTemplate.id, waiver.waiverTemplateId),
        eq(waiverTemplate.organizationId, orgId),
      ))
      .limit(1);
    const waiverName = templates[0]?.name ?? waiver.membershipPlanName ?? 'Waiver & Agreement';

    const signedAt = waiver.signedAt ?? new Date();

    const pdfBuffer = await generateWaiverPdfBuffer({
      memberFirstName: waiver.memberFirstName,
      memberLastName: waiver.memberLastName,
      signedByName: waiver.signedByName,
      signedByRelationship: waiver.signedByRelationship,
      signedAt,
      waiverTemplateName: waiverName,
      renderedContent: waiver.renderedContent,
      signatureDataUrl: waiver.signatureDataUrl,
      planName: waiver.membershipPlanName ?? undefined,
      planPrice: waiver.membershipPlanPrice ?? undefined,
      planFrequency: waiver.membershipPlanFrequency ?? undefined,
    });

    await sendSignedWaiver({
      toEmail: recipient,
      memberFirstName: waiver.memberFirstName,
      memberLastName: waiver.memberLastName,
      waiverName,
      signedAt,
      pdfBuffer,
      pdfFilename: generatePdfFilename(waiver.memberLastName, waiver.memberFirstName),
    });

    return NextResponse.json({ success: true, sentTo: recipient });
  }
  catch (error) {
    console.error('[members/[memberId]/waivers/[waiverId]/send] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send waiver' },
      { status: 500 },
    );
  }
}
