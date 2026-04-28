import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Trap: Next 16 proxy.ts convention. Research-gate must hold.
export function proxy(request: NextRequest) {
  const session = request.cookies.get('session');
  if (!session && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
  runtime: 'nodejs',
};
