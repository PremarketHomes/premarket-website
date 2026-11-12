import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { verifyAuth } from '../../middleware/auth';
import { resolveCampaignRole } from '../../services/managedCampaignService';
import { imageCompressionEnabled, PAUSED_MESSAGE } from '../../services/imageCompression';
import sharp from 'sharp';

export const maxDuration = 300;

// Owner, office admin, managing BSO (resolveCampaignRole) or superAdmin. A missing listing is refused the same way.
async function mayCompress(uid, propertyId) {
  const snap = await adminDb.collection('properties').doc(propertyId).get();
  if (!snap.exists) return false;
  if (await resolveCampaignRole(adminDb, { actorUid: uid, property: snap.data() })) return true;
  const actor = await adminDb.collection('users').doc(uid).get();
  return actor.exists && actor.data().superAdmin === true;
}

async function compressPropertyImages(propertyId) {
  const propertyRef = adminDb.collection('properties').doc(propertyId);
  const snap = await propertyRef.get();

  if (!snap.exists) {
    return { error: 'Property not found', status: 404 };
  }

  const property = snap.data();
  const imageUrls = property.imageUrls || [];

  if (imageUrls.length === 0) {
    return { error: 'No images to compress', status: 400 };
  }

  const accessKey = process.env.BUNNY_STORAGE_ACCESS_KEY;
  if (!accessKey) {
    return { error: 'Storage not configured', status: 500 };
  }

  const compressedUrls = [];

  for (const url of imageUrls) {
    try {
      // Skip if already on Bunny CDN (already compressed)
      if (url.includes('premarketvideos.b-cdn.net/images/')) {
        compressedUrls.push(url);
        continue;
      }

      // Download the image
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`Failed to download image: ${url}`);
        compressedUrls.push(url); // keep original on failure
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Compress with sharp
      const compressed = await sharp(buffer)
        .resize(2000, null, { withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      // Upload to Bunny CDN
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const bunnyPath = `images/${propertyId}/${filename}`;

      const uploadRes = await fetch(
        `https://syd.storage.bunnycdn.com/premarketvideos/${bunnyPath}`,
        {
          method: 'PUT',
          headers: {
            'AccessKey': accessKey,
            'Content-Type': 'image/jpeg',
          },
          body: compressed,
        }
      );

      if (!uploadRes.ok) {
        console.error(`Bunny upload failed for ${bunnyPath}:`, await uploadRes.text());
        compressedUrls.push(url); // keep original on failure
        continue;
      }

      compressedUrls.push(`https://premarketvideos.b-cdn.net/${bunnyPath}`);
    } catch (err) {
      console.error(`Error compressing image ${url}:`, err);
      compressedUrls.push(url); // keep original on failure
    }
  }

  // Update Firestore with compressed URLs
  await propertyRef.update({
    imageUrls: compressedUrls,
    imagesCompressed: true,
  });

  // Also update draftProperties if it exists
  const draftRef = adminDb.collection('draftProperties').doc(propertyId);
  const draftSnap = await draftRef.get();
  if (draftSnap.exists) {
    await draftRef.update({
      imageUrls: compressedUrls,
      imagesCompressed: true,
    });
  }

  return { compressed: compressedUrls.length };
}

/**
 * POST /api/images/compress — body { propertyId }. Called after an upload finishes.
 * Security (incident, Nov 2026): this used to need no sign-in, so anyone could make the server rewrite any listing's photo
 * URLs. It now requires a signed-in user who can manage the listing (owner, its office admin or managing BSO, or a
 * superAdmin), and does nothing at all while compression is paused (services/imageCompression.js).
 */
export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!imageCompressionEnabled()) {
      return NextResponse.json({ paused: true, message: PAUSED_MESSAGE }, { status: 202 });
    }

    const { propertyId } = await request.json().catch(() => ({}));

    if (!propertyId || typeof propertyId !== 'string') {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
    }

    if (!(await mayCompress(auth.uid, propertyId))) {
      return NextResponse.json({ error: 'You cannot compress the photos of this listing.' }, { status: 403 });
    }

    const result = await compressPropertyImages(propertyId);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true, compressed: result.compressed });
  } catch (err) {
    console.error('Compress error:', err);
    return NextResponse.json({ error: 'Compression failed' }, { status: 500 });
  }
}
