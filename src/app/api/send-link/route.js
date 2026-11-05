import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../../firebase/adminApp';
import { verifyAuth } from '../middleware/auth';
import { sendLink } from '../services/resendService';

/**
 * POST /api/send-link  { link, email? }
 *
 * "Email me this Premarket link." It used to send ANY link to ANY address for any signed-in user, which made it
 * an open relay for phishing. It now:
 *   - sends only to the caller's OWN verified account email (a different `email` in the body is refused),
 *   - accepts only https links on Premarket's own domain, normalised so nothing can break out of the href,
 *   - allows 20 sends per user per day (durable counter in the server-only emailLog collection).
 */
const ALLOWED_HOSTS = ['premarket.homes', 'www.premarket.homes'];
const DAILY_LIMIT = 20;

export function parsePremarketLink(raw) {
  if (typeof raw !== 'string' || raw.length > 600) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || !ALLOWED_HOSTS.includes(u.hostname) || u.port) return null;
  return u.href; // serialised: quotes, angle brackets and spaces are percent-encoded
}

async function chargeDailyAllowance(uid) {
  const day = new Date().toISOString().slice(0, 10);
  const ref = adminDb.collection('emailLog').doc(`send_link__${uid}__${day}`);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? snap.data().count || 0 : 0;
    if (count >= DAILY_LIMIT) return false;
    tx.set(ref, { type: 'send_link', uid, day, count: count + 1, updatedAt: FieldValue.serverTimestamp() });
    return true;
  });
}

export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json().catch(() => ({}));
    const link = parsePremarketLink(body.link);
    if (!body.link) return NextResponse.json({ error: 'Missing link' }, { status: 400 });
    if (!link) return NextResponse.json({ error: 'Only Premarket links can be sent' }, { status: 400 });

    // The recipient is always the signed-in user's own address (from their verified token).
    const own = String(auth.email || '').trim().toLowerCase();
    if (!own) return NextResponse.json({ error: 'Your account has no email address to send to' }, { status: 400 });
    if (body.email && String(body.email).trim().toLowerCase() !== own) {
      return NextResponse.json({ error: 'You can only send a link to your own email address' }, { status: 403 });
    }

    if (!(await chargeDailyAllowance(auth.uid))) {
      return NextResponse.json({ error: 'You have reached today’s limit for sending links. Please try again tomorrow.' }, { status: 429 });
    }

    await sendLink(link, own);
    return NextResponse.json({ success: true, message: 'Link sent successfully' });
  } catch (err) {
    console.error('Error sending link:', err);
    return NextResponse.json({ error: 'Failed to send link' }, { status: 500 });
  }
}
