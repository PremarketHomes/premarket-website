import { NextResponse } from 'next/server';
import { verifyAdmin } from '../../middleware/auth';
import {
  fetchBuyersWithPreferences,
  fetchNewestProperties,
  fetchHottestProperties,
  matchPropertiesToBuyer,
  generateNewsletterHTML,
} from '../../services/newsletterService';

export async function POST(request) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json().catch(() => ({}));
    const { email } = body;

    const [buyers, newestProperties, hottestProperties] = await Promise.all([
      fetchBuyersWithPreferences(),
      fetchNewestProperties(10),
      fetchHottestProperties(5),
    ]);

    let buyer = email ? buyers.find((b) => b.email === email) : buyers[0];

    if (!buyer) {
      buyer = {
        email: email || 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        preferences: {},
      };
    }

    const matched = matchPropertiesToBuyer(buyer, newestProperties);
    const buyerProperties = matched.length > 0 ? matched : newestProperties;

    const matchedHottest = matchPropertiesToBuyer(buyer, hottestProperties);
    const buyerHottest = matchedHottest.length > 0 ? matchedHottest : hottestProperties;

    // Read-only: renders the email for one buyer from live data. Nothing is sent.
    const html = generateNewsletterHTML(buyer, buyerProperties, buyerHottest);
    return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } });
  } catch (err) {
    console.error('Error previewing newsletter:', err);
    return NextResponse.json({ error: 'Failed to preview newsletter', details: err.message }, { status: 500 });
  }
}
