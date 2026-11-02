import { NextResponse } from 'next/server';
import { verifyAuth } from '../middleware/auth';
import { TeamError } from '../services/teamService';

/** Shared by every /api/teams/* route: authenticate, run, map TeamError -> JSON. */
export async function handleTeamRequest(request, run, label) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await run(auth);
    return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    if (err instanceof TeamError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error(`${label} error:`, err);
    return NextResponse.json({ error: 'Something went wrong. Nothing was changed — please try again.' }, { status: 500 });
  }
}
