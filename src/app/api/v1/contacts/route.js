import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { adminDb } from '../../../firebase/adminApp';
import { validateApiKey } from '../middleware';

export async function GET(request) {
  const auth = await validateApiKey(request);
  if (!auth.valid) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  // This endpoint returns real names and emails, unlike every other v1
  // route (aggregate suburb/national stats) — validateApiKey's "any
  // signed-in user" bearer fallback is correct for those, but wrong
  // here. A SuperAdmin is always fully authorised; anyone else —
  // agent, buyer, or an x-api-key caller — must have genuinely
  // approved API access, matching what the x-api-key path has always
  // required (the bearer path previously skipped this check entirely).
  const isSuperAdmin = auth.user.superAdmin === true;
  if (!isSuperAdmin && auth.user.apiAccess?.status !== 'approved') {
    return NextResponse.json({ error: 'This endpoint requires approved API access' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // agent, homeowner, buyer
    const search = searchParams.get('search');
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    let q = adminDb.collection('contacts');

    // Filter by type
    if (type === 'agent') {
      q = q.where('isAgent', '==', true);
    } else if (type === 'homeowner') {
      q = q.where('isHomeowner', '==', true);
    } else if (type === 'buyer') {
      q = q.where('isBuyer', '==', true);
    }

    q = q.orderBy('lastActivityAt', 'desc');

    const snapshot = await q.get();
    let contacts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    // Tenant scoping — applied in application code, not as a Firestore
    // query constraint, deliberately: adding an extra .where() here
    // would need a new composite index deployed before this could ever
    // work, a separate and slower deployment step than this fix. A
    // non-superAdmin (any agent, buyer, or approved API client) only
    // ever sees contacts linked to their OWN account — never the
    // platform-wide list. A contact with no linkedAgentIds at all
    // (or an array that doesn't include them) is correctly excluded,
    // fail-closed rather than fail-open.
    if (!isSuperAdmin) {
      contacts = contacts.filter((c) => Array.isArray(c.linkedAgentIds) && c.linkedAgentIds.includes(auth.user.id));
    }

    // Client-side search filter (Firestore doesn't support text search)
    if (search) {
      const s = search.toLowerCase();
      contacts = contacts.filter((c) => {
        const name = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase();
        const email = (c.email || '').toLowerCase();
        return name.includes(s) || email.includes(s);
      });
    }

    const total = contacts.length;
    contacts = contacts.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      total,
      offset,
      limit,
      contacts,
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'contacts' } });
    console.error('Contacts API error:', err);
    return NextResponse.json({ error: 'Failed to fetch contacts' }, { status: 500 });
  }
}
