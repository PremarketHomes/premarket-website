import { NextResponse } from 'next/server';
import { sendWeeklyBuyerNewsletters } from '../../services/newsletterService';
import { verifyCron } from '../../middleware/auth';

export const maxDuration = 300;

// The website newsletter only sends when NEWSLETTER_SEND_ENABLED is exactly 'true'.
// It is switched OFF by default so it can never email buyers in the same weekly
// cycle as the legacy Firebase newsletter (`sendWeeklyBuyerNewsletter`). The switch
// is a deliberate, coordinated step: retire/confirm the legacy sender, set the
// variable in Vercel and redeploy. Applies to the Friday cron AND the manual POST.
export function isNewsletterSendEnabled() {
  return process.env.NEWSLETTER_SEND_ENABLED === 'true';
}

async function runNewsletter() {
  if (!isNewsletterSendEnabled()) {
    return NextResponse.json({
      success: true,
      skipped: true,
      message: 'Website newsletter is switched off (NEWSLETTER_SEND_ENABLED is not "true"); nothing was sent.',
    });
  }
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
