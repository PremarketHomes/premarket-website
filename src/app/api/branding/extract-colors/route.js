import { NextResponse } from 'next/server';
import { verifyAuth } from '../../middleware/auth';
import { extractBrandColors } from '../../services/brandColorExtractor';

/**
 * Suggests a colour palette from an already-uploaded logo. Read-only —
 * never writes anything. The agent always confirms (or manually adjusts)
 * before anything is saved via /api/branding/confirm.
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

    let imageResponse;
    try {
      imageResponse = await fetch(logoUrl);
    } catch (err) {
      console.error('Branding: failed to fetch logo', err);
      return NextResponse.json({ error: 'Could not load the logo image. Please try again.' }, { status: 502 });
    }
    if (!imageResponse.ok) {
      return NextResponse.json({ error: 'Could not load the logo image. Please try again.' }, { status: 502 });
    }
    const buffer = Buffer.from(await imageResponse.arrayBuffer());

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
