import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { verifyCron } from '../../middleware/auth';

export async function GET(request) {
  const auth = verifyCron(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    // Get all properties that have imageUrls
    const snapshot = await adminDb.collection('properties').get();

    let flagged = 0;
    let alreadyCompressed = 0;
    let noImages = 0;

    const batch = adminDb.batch();

    for (const doc of snapshot.docs) {
      const data = doc.data();

      if (data.imagesCompressed === true) {
        alreadyCompressed++;
        continue;
      }

      const imageUrls = data.imageUrls || [];
      if (imageUrls.length === 0) {
        noImages++;
        continue;
      }

      batch.update(doc.ref, { imagesCompressed: false });
      flagged++;
    }

    if (flagged > 0) {
      await batch.commit();
    }

    return NextResponse.json({
      success: true,
      flagged,
      alreadyCompressed,
      noImages,
      total: snapshot.size,
    });
  } catch (err) {
    console.error('Backfill error:', err);
    return NextResponse.json({ error: 'Backfill failed' }, { status: 500 });
  }
}
