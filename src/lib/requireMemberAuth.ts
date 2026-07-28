import { NextResponse } from 'next/server';
import { resolveOrgIdFromRequest } from '@/lib/clerk';
import { getSessionFromCookie } from '@/lib/memberSession';

interface MemberAuthSession {
  memberId: string;
  orgId: string;
  firstName: string;
  lastName: string;
  email: string;
  actingStaffEmail?: string;
  jti?: string;
}

type MemberAuthResult
  = { ok: true; session: MemberAuthSession; orgId: string }
    | { ok: false; response: NextResponse };

/**
 * Authorize a request against a specific member's data.
 *
 * The `members/[memberId]/*` routes back both the member's own portal and a
 * staff-assist surface on the kiosk. Both mint a signed `member_session`
 * (via verify-otp / staff-verify-otp), so the single control here is: a valid
 * session whose `memberId` and `orgId` match the route's target.
 *
 * The `?org=` slug is used ONLY to confirm it matches the session's org — it is
 * never trusted as the authorization boundary on its own (the old bug: routes
 * trusted the public slug + a client-supplied memberId with no session at all).
 *
 * Pass `requireStaff: true` for actions only a staff-assisted session may take
 * (e.g. waiving a fee): the session must carry `actingStaffEmail`, set only when
 * an eligible staff member unlocked the portal via staff-verify-otp.
 */
export async function requireMemberAuth(
  request: Request,
  memberId: string,
  opts: { requireStaff?: boolean } = {},
): Promise<MemberAuthResult> {
  const session = await getSessionFromCookie(request);
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  // The session pins the member and org; a request for a different member (or a
  // ?org= that disagrees with the session) is a cross-account/cross-tenant
  // attempt and is refused.
  if (session.memberId !== memberId) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  const requestedOrgId = await resolveOrgIdFromRequest(request);
  if (requestedOrgId && requestedOrgId !== session.orgId) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  if (opts.requireStaff && !session.actingStaffEmail) {
    return { ok: false, response: NextResponse.json({ error: 'Staff authorization required' }, { status: 403 }) };
  }

  return { ok: true, session, orgId: session.orgId };
}
