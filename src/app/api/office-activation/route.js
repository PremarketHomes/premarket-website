import { NextResponse } from 'next/server';
import { inspectActivationToken, redeemActivationToken } from '../services/officeActivationService';

/**
 * POST /api/office-activation
 *   { token }                       -> read-only check (page load): { firstName, officeName } | { alreadyActive }
 *   { token, intent: 'continue' }   -> the agent submitted their password: { oobCode } | { alreadyActive }
 *
 * Public — the secret token in the emailed link is the credential. Only an explicit
 * 'continue' ever mints a Firebase password code, so scanners/prefetchers that merely open
 * the page can never use up or replace the agent's link. Never reveals whether an account
 * exists beyond a generic message.
 */
export async function POST(request) {
  try {
    const { token, intent } = await request.json();
    const result = intent === 'continue' ? await redeemActivationToken(token) : await inspectActivationToken(token);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('Office activation error:', err);
    return NextResponse.json(
      { error: status >= 500 ? 'Something went wrong. Please try again.' : err.message },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
