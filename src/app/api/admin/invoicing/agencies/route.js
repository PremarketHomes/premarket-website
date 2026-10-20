import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../../middleware/auth';
import { findPossibleDuplicateAgencies } from '../../../services/billingService';

/**
 * GET /api/admin/invoicing/agencies
 *
 * Lists pairs of billing entities whose names look like they might be
 * the same real agency (see billingService.findPossibleDuplicateAgencies
 * for the exact heuristic and its known limits). Read-only; an admin
 * reviews these and, if they confirm a pair is really a duplicate,
 * calls POST .../agencies/merge to fix it.
 */
export async function GET(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const possibleDuplicates = await findPossibleDuplicateAgencies();
    return NextResponse.json({ possibleDuplicates });
  } catch (err) {
    console.error('Find possible duplicate agencies error:', err);
    return NextResponse.json({ error: 'Failed to check for duplicate agencies' }, { status: 500 });
  }
}
