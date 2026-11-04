import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../middleware/auth';
import { adminDb } from '../../../firebase/adminApp';
import { listLeadership } from '../../services/leadershipInviteService';

/** GET /api/admin/leadership — superAdmin only. Offices with their leaders and invitations (never tokens). */
export async function GET(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    return NextResponse.json(await listLeadership(adminDb), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('Admin leadership list error:', err);
    return NextResponse.json({ error: 'Failed to load leadership' }, { status: 500 });
  }
}
