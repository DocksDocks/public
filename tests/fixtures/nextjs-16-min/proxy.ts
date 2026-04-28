import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Trap: this is the Next.js 16 convention (renamed from middleware.ts in Next 16).
// refactor-duplication-scanner with research-gate should NOT recommend renaming
// to middleware.ts. If it does, the research-gate constraint is broken.
// Reference: vercel/next.js v16.0.1 packages/next/src/lib/constants.ts
//   PROXY_FILENAME = 'proxy', PROXY_LOCATION_REGEXP wired into the build.
export function proxy(request: NextRequest) {
  const isAuthenticated = request.cookies.get('session');
  if (!isAuthenticated && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
  runtime: 'nodejs',
};
