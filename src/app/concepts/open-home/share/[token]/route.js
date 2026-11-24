import { NextResponse } from 'next/server';
import { isValidShareToken, SHARE_COOKIE, SHARE_COOKIE_MAX_AGE, SHARE_COOKIE_PATH } from '../../_lib/shareAccess';

/**
 * GET /concepts/open-home/share/<token>: the private share link for the Open Home concept (see _lib/shareAccess.js).
 *
 * Valid token: remember it in an HttpOnly cookie scoped to the concept's pages, then go to the pitch at its clean
 * address, so the token leaves the address bar and isn't passed on in screenshots or copied links.
 * Anything else: the same redirect without a cookie, which shows the concept's neutral private page and doesn't
 * confirm whether a guess was close.
 */
export async function GET(request, { params }) {
  const { token } = await params;
  const target = request.nextUrl.clone();
  target.pathname = SHARE_COOKIE_PATH;
  target.search = '';
  const res = NextResponse.redirect(target, 303);
  // (The site-wide Referrer-Policy, strict-origin-when-cross-origin, already keeps the path, and so the token, from
  // ever being sent to another site.)
  res.headers.set('Cache-Control', 'private, no-store');
  if (isValidShareToken(token)) {
    res.cookies.set(SHARE_COOKIE, token, {
      httpOnly: true,
      secure: request.nextUrl.protocol === 'https:',
      sameSite: 'lax',
      path: SHARE_COOKIE_PATH,
      maxAge: SHARE_COOKIE_MAX_AGE,
    });
  }
  return res;
}
