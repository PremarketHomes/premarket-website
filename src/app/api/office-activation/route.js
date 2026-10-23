import { NextResponse } from 'next/server';
import { redeemActivationToken } from '../services/officeActivationService';

/**
 * POST /api/office-activation   Body: { token }
 * Public — the secret token in the emailed link is the credential. Exchanges it for a fresh
 * Firebase password-setup URL (see officeActivationService.js). Never reveals whether an
 * account exists beyond a generic message.
 */
export async function POST(request) {
  try {
    const { token } = await request.json();
    const result = await redeemActivationToken(token);
    return NextResponse.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('Office activation error:', err);
    return NextResponse.json({ error: status >= 500 ? 'Something went wrong. Please try again.' : err.message }, { status });
  }
}
