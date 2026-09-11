import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { verifyAuth } from '../../middleware/auth';
import { adminDb } from '../../../firebase/adminApp';
import { getPropertyImage, formatPriceShort } from '../../../utils/formatters';
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  computeOpinionStats,
  wrapAddressLines,
} from '../../services/propertyCardService';
import { renderPropertyCardPng } from '../../services/propertyCardRenderer';

export const maxDuration = 60;

/**
 * Generates the Shareable Property Card as a 1080x1350 PNG for an existing
 * property's Report. Read-only: fetches the property + its offers, reads
 * the same fields/collections the Report page does, and writes nothing to
 * Firestore. The hero image is fetched here (server-side) rather than
 * drawn onto a browser <canvas>, specifically so CORS headers on the
 * Bunny-hosted image can never break generation in production — a server
 * fetch is not subject to CORS at all.
 */
export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { propertyId } = await request.json();
    if (!propertyId || typeof propertyId !== 'string') {
      return NextResponse.json({ error: 'Missing propertyId' }, { status: 400 });
    }

    const propertyDoc = await adminDb.collection('properties').doc(propertyId).get();
    if (!propertyDoc.exists) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }
    const property = propertyDoc.data();

    // Same ownership rule as the Report page (dashboard/property/[id]/page.js).
    if (property.userId !== auth.uid) {
      const userDoc = await adminDb.collection('users').doc(auth.uid).get();
      const isSuperAdmin = userDoc.exists && userDoc.data().superAdmin === true;
      if (!isSuperAdmin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const imageUrl = getPropertyImage(property);
    if (!imageUrl) {
      return NextResponse.json(
        { error: 'This property has no photos yet — add one before generating a shareable card.' },
        { status: 400 }
      );
    }

    // Read-only: the exact same offers the Report reads for this property.
    // No Firestore writes anywhere in this route.
    const offersSnap = await adminDb.collection('offers').where('propertyId', '==', propertyId).get();
    const offers = offersSnap.docs.map((d) => d.data());
    const { opinionsCount, seriousBuyersCount, combinedMedian } = computeOpinionStats(offers);
    const viewsCount = property.stats?.views || 0;
    const medianDisplay = formatPriceShort(combinedMedian);

    const address = property.formattedAddress || property.address || '';
    const addressLines = wrapAddressLines(address);

    let imageResponse;
    try {
      imageResponse = await fetch(imageUrl);
    } catch (err) {
      console.error('Property card: failed to fetch hero image', err);
      return NextResponse.json({ error: 'Could not load the property photo. Please try again.' }, { status: 502 });
    }
    if (!imageResponse.ok) {
      return NextResponse.json({ error: 'Could not load the property photo. Please try again.' }, { status: 502 });
    }
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

    // Crop-to-cover so the property photo fills the canvas without ever
    // being stretched or distorted.
    const heroBuffer = await sharp(imageBuffer)
      .resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'cover', position: 'centre' })
      .toBuffer();

    const cardBuffer = await renderPropertyCardPng({
      heroBuffer,
      addressLines,
      viewsCount,
      opinionsCount,
      seriousBuyersCount,
      medianDisplay,
    });

    return new NextResponse(cardBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('Property card generation error:', err);
    return NextResponse.json({ error: 'Failed to generate the shareable card. Please try again.' }, { status: 500 });
  }
}
