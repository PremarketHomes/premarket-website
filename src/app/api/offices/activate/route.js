import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { markOfficeAccountActivated } from '../../services/officeService';

/**
 * POST /api/offices/activate
 *
 * Called once, right after a successful login (see login/page.js),
 * to flip an office-invited agent's accountStatus from 'invited' to
 * 'active' — this is the ONLY place that happens, and only once the
 * caller has genuinely authenticated as themselves (a real password
 * was set and a real sign-in succeeded). Safe to call on EVERY login,
 * for every account: markOfficeAccountActivated is a no-op for
 * anyone who isn't a still-'invited' office account, which is every
 * ordinary individual-agent login.
 */
export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const result = await markOfficeAccountActivated(auth.uid);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Office activation error:', err);
    return NextResponse.json({ error: 'Failed to finalize activation' }, { status: 500 });
  }
}
