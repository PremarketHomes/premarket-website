import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { getOfficeForUser } from '../../services/officeService';

/**
 * GET /api/offices/mine
 *
 * The AUTHENTICATED caller's own office (if any) plus whether they
 * administer it. Used to gate and populate the Office Management
 * dashboard — returns null, not an error, for any agent who isn't in
 * an office (the overwhelming majority of existing agents).
 */
export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const office = await getOfficeForUser(auth.uid);
    return NextResponse.json({ office });
  } catch (err) {
    console.error('Get my office error:', err);
    return NextResponse.json({ error: 'Failed to load office' }, { status: 500 });
  }
}
