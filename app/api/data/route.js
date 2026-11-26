import { NextResponse } from 'next/server';
import { loadDashboard } from '../../../lib/data.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await loadDashboard(), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
