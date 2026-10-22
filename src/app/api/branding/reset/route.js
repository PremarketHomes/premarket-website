import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { resetPersonalBrandOverride } from '../../services/brandProfileService';

/**
 * POST /api/branding/reset
 *
 * "Reset to Agency Branding" — clears the AUTHENTICATED caller's own
 * personal logo/colour override, falling back to their inherited
 * shared brand (or the Premarket default, if they have none). Never
 * touches agencyBrandId itself, the shared agencyBrands doc, or any
 * other agent's data — see resetPersonalBrandOverride.
 */
export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const result = await resetPersonalBrandOverride({ uid: auth.uid });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Branding reset error:', err);
    return NextResponse.json({ error: err.message || 'Failed to reset branding' }, { status: 500 });
  }
}
