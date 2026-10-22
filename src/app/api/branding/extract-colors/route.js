import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { extractBrandColors } from '../../services/brandColorExtractor';
import { safeFetchExternalImage, UnsafeUrlError } from '../../services/safeExternalFetch';

/**
 * Suggests a colour palette from a logo URL — reused by both the
 * personal branding page and the office branding card (see
 * dashboard/office/page.js), so there is exactly one place that
 * fetches a user-supplied URL server-side, and exactly one place
 * hardened against SSRF (safeFetchExternalImage) rather than each
 * caller growing its own. Read-only — never writes anything. The
 * agent/office admin always confirms (or manually adjusts) before
 * anything is saved via /api/branding/confirm or
 * /api/offices/{officeId}/branding.
 */
export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { logoUrl } = await request.json();
    if (!logoUrl || typeof logoUrl !== 'string') {
      return NextResponse.json({ error: 'Missing logoUrl' }, { status: 400 });
    }

    let buffer;
    try {
      buffer = await safeFetchExternalImage(logoUrl);
    } catch (err) {
      if (err instanceof UnsafeUrlError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      console.error('Branding: failed to fetch logo -', err.message);
      return NextResponse.json({ error: 'Could not load the logo image. Please check the URL and try again.' }, { status: 502 });
    }

    const result = await extractBrandColors(buffer);
    if (!result.usable) {
      return NextResponse.json({
        usable: false,
        message: 'We couldn\'t confidently pick colours from this logo — please choose them manually.',
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('Branding colour extraction error:', err);
    return NextResponse.json({ error: 'Failed to analyse logo colours. Please try again.' }, { status: 500 });
  }
}
