import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  // Skip all auth in development
  if (process.env.NODE_ENV === 'development') {
    return NextResponse.next();
  }

  const hostname = request.headers.get('host') ?? '';
  const pathname = request.nextUrl.pathname;

  // Kiosk subdomain: require proxy secret header
  if (hostname.startsWith('kiosk.')) {
    const proxySecret = process.env.PROXY_SECRET;
    if (proxySecret && request.headers.get('x-proxy-secret') !== proxySecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Member portal subdomain: require session cookie for dashboard routes
  if (hostname.startsWith('my.')) {
    // Public routes that don't need auth
    if (
      pathname.match(/^\/[^/]+$/) // /{orgSlug} — phone entry
      || pathname.match(/^\/[^/]+\/verify$/) // /{orgSlug}/verify — OTP
      || pathname.startsWith('/api/member-portal/lookup')
      || pathname.startsWith('/api/member-portal/send-otp')
      || pathname.startsWith('/api/member-portal/verify-otp')
    ) {
      return NextResponse.next();
    }

    // Dashboard routes require session cookie
    if (pathname.includes('/dashboard')) {
      const sessionCookie = request.cookies.get('member_session');
      if (!sessionCookie?.value) {
        // Extract orgSlug from pathname
        const slugMatch = pathname.match(/^\/([^/]+)/);
        const orgSlug = slugMatch?.[1] ?? '';
        return NextResponse.redirect(new URL(`/${orgSlug}`, request.url));
      }
    }

    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all routes except static assets
    '/((?!_next/static|_next/image|favicon|.*\\.(?:svg|png|jpg|jpeg|gif|ico|webp|woff|woff2|ttf|eot)$).*)',
  ],
};
