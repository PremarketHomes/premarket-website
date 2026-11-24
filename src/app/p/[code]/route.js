import { NextResponse } from 'next/server';
import { adminDb } from '../../firebase/adminApp';
import { resolveShortCode } from '../../api/services/shortLinkService';
import { normalizeShortCode } from '../../utils/shortLinks';

/**
 * GET /p/{code}: a campaign short link (see utils/shortLinks.js).
 *
 * One same-site redirect to the campaign's existing buyer page, /find-property?propertyId=..., which keeps doing
 * everything it does today: view counting, scanner filtering, price opinions, registrations, the iPad mode, and its
 * handling of archived, sold, private and preview campaigns. Nothing here records a view (views are counted by the
 * buyer page in the visitor's browser), so link scanners that only follow the redirect never count as a visit.
 * Query parameters on the short link are passed through (e.g. ?mode=ipad), except propertyId.
 *
 * A code we don't know, or one whose campaign has been deleted, gets a small branded page (404 / 410) instead.
 */
export const dynamic = 'force-dynamic';

const REDIRECT_CACHE = 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600';

export async function GET(request, { params }) {
  const { code: raw } = await params;
  const code = normalizeShortCode(raw);
  if (!code) return page(404, NOT_FOUND);

  let result;
  try {
    result = await resolveShortCode(adminDb, code);
  } catch (err) {
    console.error('Short link lookup failed:', err?.message || err);
    return page(503, UNAVAILABLE, 'no-store');
  }

  if (result.status === 'gone') return page(410, GONE);
  if (result.status !== 'ok') return page(404, NOT_FOUND, 'public, max-age=0, s-maxage=60');

  const incoming = new URL(request.url);
  const destination = new URL('/find-property', incoming.origin);
  destination.searchParams.set('propertyId', result.propertyId);
  for (const [key, value] of incoming.searchParams) {
    if (key !== 'propertyId') destination.searchParams.append(key, value);
  }
  return NextResponse.redirect(destination, { status: 302, headers: { 'Cache-Control': REDIRECT_CACHE } });
}

export const HEAD = GET;

const NOT_FOUND = {
  title: 'This link isn’t working',
  body: 'Please check the link in your message, or ask the agent who sent it for a new one.',
};
const GONE = {
  title: 'This property is no longer available',
  body: 'The campaign for this property has been removed. Please contact the agent who sent you the link.',
};
const UNAVAILABLE = {
  title: 'Something went wrong',
  body: 'We couldn’t open this link just now. Please try again in a moment.',
};

function page(status, { title, body }, cacheControl = 'public, max-age=0, s-maxage=300') {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} | Premarket</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;color:#0f172a;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:24px;box-sizing:border-box}
  main{max-width:420px;text-align:center}
  .brand{font-weight:700;letter-spacing:-0.01em;color:#ea580c;font-size:18px;margin:0 0 28px}
  h1{font-size:22px;line-height:1.3;margin:0 0 12px}
  p{font-size:15px;line-height:1.6;color:#475569;margin:0 0 28px}
  a.btn{display:inline-block;background:#0f172a;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:10px}
</style>
</head>
<body>
<main>
  <p class="brand">Premarket</p>
  <h1>${title}</h1>
  <p>${body}</p>
  <a class="btn" href="/">Go to premarket.homes</a>
</main>
</body>
</html>`;
  return new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cacheControl, 'X-Robots-Tag': 'noindex' },
  });
}
