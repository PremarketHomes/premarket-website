import { NextResponse } from 'next/server';
import { verifyAuth } from '../../../middleware/auth';
import { requireOfficeAdmin, listOfficeAgents, computeOfficeStats } from '../../../services/officeService';
import { processOneRow, listStagedAgents } from '../../../services/officeImportService';

/**
 * GET /api/offices/{officeId}/agents
 * Office-admin only. Returns the full roster (members + pending
 * existing-account invites) plus simple counts — never any
 * property/offer/report/billing data for any agent.
 */
export async function GET(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { officeId } = await params;
    await requireOfficeAdmin({ officeId, uid: auth.uid });

    const members = await listOfficeAgents(officeId);
    // Staged (not yet sent) and failed invitations, minus anyone already on the roster.
    const known = new Set(members.map((a) => (a.email || '').toLowerCase()));
    const staged = (await listStagedAgents(officeId)).filter((a) => !known.has((a.email || '').toLowerCase()));
    const agents = [...members, ...staged];
    return NextResponse.json({ agents, stats: computeOfficeStats(agents) });
  } catch (err) {
    console.error('List office agents error:', err);
    return NextResponse.json({ error: err.message || 'Failed to load agents' }, { status: err.status || 500 });
  }
}

/**
 * POST /api/offices/{officeId}/agents
 * Body: { name, email, phone }
 * Office-admin only. Adds exactly one agent — reuses the identical
 * per-row logic the CSV commit path uses (processOneRow), so "add one
 * agent" and "import a CSV of one row" can never behave differently.
 */
export async function POST(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { officeId } = await params;
    const office = await requireOfficeAdmin({ officeId, uid: auth.uid });

    const { name, email, phone } = await request.json();
    if (!name || !email || !phone) {
      return NextResponse.json({ error: 'Name, email and phone are all required' }, { status: 400 });
    }

    const result = await processOneRow({
      officeId,
      officeName: office.name,
      row: { name, email: String(email).trim().toLowerCase(), phone },
      actorUid: auth.uid,
    });

    if (result.outcome === 'failed') {
      return NextResponse.json({ error: result.error || 'Failed to add agent' }, { status: 400 });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Add office agent error:', err);
    return NextResponse.json({ error: err.message || 'Failed to add agent' }, { status: err.status || 500 });
  }
}
