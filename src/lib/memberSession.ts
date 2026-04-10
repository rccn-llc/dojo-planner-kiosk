import { jwtVerify, SignJWT } from 'jose';

interface MemberSessionPayload {
  memberId: string;
  orgId: string;
  firstName: string;
  lastName: string;
  email: string;
}

function getSecret(): Uint8Array {
  const secret = process.env.MEMBER_SESSION_SECRET;
  if (!secret) {
    throw new Error('MEMBER_SESSION_SECRET environment variable is required');
  }
  return new TextEncoder().encode(secret);
}

/**
 * Create a signed JWT session token for a member.
 */
export async function createMemberSession(
  payload: MemberSessionPayload,
  expiresInSeconds: number,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(getSecret());
}

/**
 * Verify and decode a member session JWT.
 * Returns the payload or null if invalid/expired.
 */
export async function verifyMemberSession(
  token: string,
): Promise<MemberSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const p = payload as Record<string, unknown>;

    if (!p.memberId || !p.orgId) {
      return null;
    }

    return {
      memberId: p.memberId as string,
      orgId: p.orgId as string,
      firstName: (p.firstName as string) ?? '',
      lastName: (p.lastName as string) ?? '',
      email: (p.email as string) ?? '',
    };
  }
  catch {
    return null;
  }
}

/**
 * Extract a session token from an incoming request.
 * Checks the `member_session` cookie first, then the Authorization header.
 */
export async function getSessionFromCookie(
  request: Request,
): Promise<MemberSessionPayload | null> {
  // Try cookie
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const [key, ...rest] = c.trim().split('=');
      return [key, rest.join('=')] as [string, string];
    }),
  );
  const cookieToken = cookies.member_session;
  if (cookieToken) {
    const payload = await verifyMemberSession(cookieToken);
    if (payload) {
      return payload;
    }
  }

  // Try Authorization header
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    return verifyMemberSession(token);
  }

  return null;
}

/**
 * Set the session cookie on a response.
 */
export function setSessionCookie(
  response: Response,
  token: string,
  maxAgeSeconds: number,
): Response {
  const cookie = `member_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${
    process.env.NODE_ENV === 'production' ? '; Secure' : ''
  }`;
  response.headers.append('Set-Cookie', cookie);
  return response;
}
