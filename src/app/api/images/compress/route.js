import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import sharp from 'sharp';

export const maxDuration = 300;

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

      // The client already resizes/re-encodes new uploads to ~2000px wide
      // before they reach Storage (see utils/imageUpload.js). Recompressing
      // an image that's already at or under the target width just costs a
      // second lossy JPEG generation for no size benefit — skip straight to
      // re-uploading those bytes as-is. Anything still oversized (older
      // uploads from before this change, or a non-browser source) still
      // gets resized/compressed exactly as before.
      const metadata = await sharp(buffer).metadata();
      const alreadySized = (metadata.width || 0) <= 2050 && metadata.format === 'jpeg';

      const compressed = alreadySized
        ? buffer
        : await sharp(buffer)
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

export async function POST(request) {
  try {
    const { propertyId } = await request.json();

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 });
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
