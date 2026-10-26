import { NextResponse } from 'next/server';
import { adminDb } from '../../firebase/adminApp';

/**
 * POST /api/unsubscribe  { email }
 *
 * Logged-out unsubscribe. The page used to query `users` by email from the
 * browser, which only worked because user documents were publicly readable
 * (and its follow-up update was already denied for a logged-out visitor).
 * Done server-side now. The response never reveals whether the address
 * belongs to an account, so this cannot be used to enumerate users.
 */
export async function POST(request) {
  try {
    const { email } = await request.json();
    const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!normalized.includes('@') || normalized.length > 254) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
    }

    const snapshot = await adminDb.collection('users').where('email', '==', normalized).limit(5).get();
    await Promise.all(
      snapshot.docs.map((d) => d.ref.update({ unsubscribed: true, unsubscribedAt: new Date() })),
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('unsubscribe error:', error);
    return NextResponse.json({ error: 'Failed to unsubscribe' }, { status: 500 });
  }
}
