import { NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionToken, safeEqual } from './lib/auth.js';

// Password protection is on when DASHBOARD_PASSWORD is set in Vercel.
export async function middleware(req) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookie && safeEqual(cookie, await sessionToken(password))) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  const login = req.nextUrl.clone();
  login.pathname = '/login';
  login.search = '';
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/|login|api/login|icon.svg|favicon.ico).*)'],
};
