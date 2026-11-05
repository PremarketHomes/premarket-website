import { NextResponse } from 'next/server';
import { verifyAuth } from '../../../middleware/auth';
import { requireOfficeAdmin } from '../../../services/officeService';

/**
 * Shared guard for every office-team route: authenticated + administrator of THIS office (never trusts
 * the client about who the caller is or which office is meant). Errors carry their own status.
 */
export async function withOfficeAdmin(request, params, fn) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const p = await params;
    await requireOfficeAdmin({ officeId: p.officeId, uid: auth.uid });
    const body = ['GET', 'DELETE'].includes(request.method) ? {} : await request.json().catch(() => ({}));
    const result = await fn({ officeId: p.officeId, actorUid: auth.uid, params: p, body, url: new URL(request.url) });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (!err.status) console.error('Office team error:', err);
    return NextResponse.json({ error: err.message || 'Request failed', code: err.code || undefined }, { status: err.status || 500 });
  }
}
