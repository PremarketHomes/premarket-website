import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { getOfficeInviteByToken, acceptOfficeInvite } from '../../services/officeImportService';

/**
 * GET /api/office-invites/{token}
 * Public (no auth) — the accept page needs to show "You've been
 * invited to join {officeName}" before the person has necessarily
 * logged in. Returns only the office name and target email, never the
 * full invite document.
 */
export async function GET(request, { params }) {
  try {
    const { token } = await params;
    const invite = await getOfficeInviteByToken(token);
    if (!invite) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    }
    return NextResponse.json({ invite });
  } catch (err) {
    console.error('Get office invite error:', err);
    return NextResponse.json({ error: 'Failed to load invitation' }, { status: 500 });
  }
}

/**
 * POST /api/office-invites/{token}
 * Authenticated. The ONLY path that sets officeId for an agent who
 * already had a Premarket account — and only after they, signed in as
 * themselves, explicitly accept. Rejects if the signed-in uid doesn't
 * match the invite's own target, so no one can accept on someone
 * else's behalf.
 */
export async function POST(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { token } = await params;
    const result = await acceptOfficeInvite({ token, acceptingUid: auth.uid });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Accept office invite error:', err);
    return NextResponse.json({ error: err.message || 'Failed to accept invitation' }, { status: err.status || 500 });
  }
}
