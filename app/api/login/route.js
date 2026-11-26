import { NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionToken, safeEqual } from '../../../lib/auth.js';

export async function POST(req) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.json({ ok: true });

  let given = '';
  try {
    given = String((await req.json()).password || '');
  } catch {
    /* empty body */
  }
  if (!safeEqual(given, password)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sessionToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
