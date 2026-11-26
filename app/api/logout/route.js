import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../lib/auth.js';

export async function POST(req) {
  const res = NextResponse.redirect(new URL('/login', req.url), 303);
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
