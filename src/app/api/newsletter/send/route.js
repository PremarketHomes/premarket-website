import { NextResponse } from 'next/server';
import { sendWeeklyBuyerNewsletters } from '../../services/newsletterService';
import { verifyCron } from '../../middleware/auth';

export const maxDuration = 300;

async function runNewsletter() {
  const results = await sendWeeklyBuyerNewsletters();
  return NextResponse.json({ success: true, message: 'Newsletter job completed', ...results });
}

/**
 * GET — called by Vercel cron (Saturday 9am AEST).
 */
export async function GET(request) {
  const auth = verifyCron(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    return await runNewsletter();
  } catch (err) {
    console.error('Error sending newsletters:', err);
    return NextResponse.json({ error: 'Failed to send newsletters', details: err.message }, { status: 500 });
  }
}

/**
 * POST — called by admin manual trigger proxy.
 */
export async function POST(request) {
  const auth = verifyCron(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    return await runNewsletter();
  } catch (err) {
    console.error('Error sending newsletters:', err);
    return NextResponse.json({ error: 'Failed to send newsletters', details: err.message }, { status: 500 });
  }
}
