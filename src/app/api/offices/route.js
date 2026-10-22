import { NextResponse } from 'next/server';
import { verifyAuth } from '../middleware/auth';
import { createOffice } from '../services/officeService';

/**
 * POST /api/offices
 * Body: { name }
 *
 * Registers a new office for the AUTHENTICATED caller, who becomes
 * its sole initial administrator — called right after their own
 * Firebase Auth account + basic users/{uid} doc already exist (the
 * join/page.js "Option B" flow). The office name is always resolved
 * from this request, never a client-supplied uid/officeId, so a
 * caller can only ever register an office for themselves.
 */
export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { name } = await request.json();
    const result = await createOffice({ adminUid: auth.uid, name });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Create office error:', err);
    return NextResponse.json({ error: err.message || 'Failed to create office' }, { status: err.status || 500 });
  }
}
