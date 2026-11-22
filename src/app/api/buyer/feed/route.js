import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { verifyAuth } from '../../middleware/auth';
import { isExcludedOpinion } from '../../../utils/opinionExclusion';

/**
 * GET /api/buyer/feed
 *
 * Activity feed for the current buyer. Returns a reverse-chronological list
 * of recent events relevant to the buyer:
 *
 *  - new listings in their watched areas
 *  - properties that recently became premarket / on-market
 *  - new opinions on properties they've liked
 *
 * Without a dedicated `events` collection we synthesize the feed by querying
 * recent property/offer documents and joining against the buyer's watched
 * areas + likes.
 */

const FEED_LIMIT = 25;
const LOOKBACK_DAYS = 14;

function tsToMs(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (ts.toMillis) return ts.toMillis();
  if (ts._seconds) return ts._seconds * 1000;
  if (ts.seconds) return ts.seconds * 1000;
  return 0;
}

function suburbMatch(propertySuburb, watchedSuburbs) {
  if (!propertySuburb) return false;
  const lower = String(propertySuburb).toLowerCase();
  return watchedSuburbs.some((s) => lower.includes(s));
}

export async function GET(request) {
  const auth = await verifyAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    // 1. Load watched areas + likes in parallel
    const [areasSnap, likesSnap] = await Promise.all([
      adminDb.collection('watchedAreas').where('userId', '==', auth.uid).get(),
      adminDb.collection('likes').where('userId', '==', auth.uid).get(),
    ]);

    const watchedAreas = areasSnap.docs.map((d) => d.data());
    const watchedSuburbs = watchedAreas
      .map((a) => (a.suburb || '').toLowerCase())
      .filter(Boolean);
    const likedPropertyIds = new Set(
      likesSnap.docs.map((d) => d.data().propertyId).filter(Boolean)
    );

    const since = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    const events = [];

    // 2. Recent properties — new listings + status changes
    if (watchedSuburbs.length > 0 || likedPropertyIds.size > 0) {
      const recentPropsSnap = await adminDb
        .collection('properties')
        .where('active', '==', true)
        .orderBy('createdAt', 'desc')
        .limit(120)
        .get();

      for (const doc of recentPropsSnap.docs) {
        const p = { id: doc.id, ...doc.data() };
        const createdMs = tsToMs(p.createdAt);
        const updatedMs = tsToMs(p.updatedAt);
        const matchedArea = suburbMatch(p.suburb || p.address, watchedSuburbs);
        const isLiked = likedPropertyIds.has(p.id);

        if (!matchedArea && !isLiked) continue;

        // New listing event
        if (createdMs >= since) {
          events.push({
            id: `new_${p.id}`,
            type: p.visibility === false ? 'new_premarket' : 'new_listing',
            timestamp: createdMs,
            title:
              p.visibility === false
                ? 'New pre-market property'
                : 'New listing',
            propertyId: p.id,
            propertyAddress: p.formattedAddress || p.address || p.suburb,
            propertyImage: p.imageUrls?.[0] || null,
            price: p.price || null,
            suburb: p.suburb || null,
            isLiked,
            inWatchedArea: matchedArea,
          });
        } else if (
          updatedMs >= since &&
          updatedMs > createdMs + 24 * 60 * 60 * 1000
        ) {
          // Status / update event (only if updated meaningfully after creation)
          events.push({
            id: `update_${p.id}_${updatedMs}`,
            type: 'updated',
            timestamp: updatedMs,
            title: 'Listing updated',
            propertyId: p.id,
            propertyAddress: p.formattedAddress || p.address || p.suburb,
            propertyImage: p.imageUrls?.[0] || null,
            price: p.price || null,
            suburb: p.suburb || null,
            isLiked,
            inWatchedArea: matchedArea,
          });
        }
      }
    }

    // 3. Recent serious offers on liked properties (social proof)
    if (likedPropertyIds.size > 0) {
      const idsArr = Array.from(likedPropertyIds).slice(0, 30);
      if (idsArr.length > 0) {
        const offersSnap = await adminDb
          .collection('offers')
          .where('propertyId', 'in', idsArr)
          .orderBy('createdAt', 'desc')
          .limit(50)
          .get();

        for (const doc of offersSnap.docs) {
          const o = { id: doc.id, ...doc.data() };
          if (isExcludedOpinion(o)) continue; // excluded by Premarket (utils/opinionExclusion.js)
          const ms = tsToMs(o.createdAt);
          if (ms < since) continue;
          // Don't show the current user their own opinions
          if (o.userId === auth.uid) continue;
          events.push({
            id: `offer_${o.id}`,
            type: 'opinion',
            timestamp: ms,
            title:
              o.seriousnessLevel === 'ready_to_buy'
                ? 'Another serious buyer is watching'
                : 'New opinion submitted',
            propertyId: o.propertyId,
            propertyAddress: o.propertyAddress || null,
            seriousness: o.seriousnessLevel || null,
            isLiked: true,
            inWatchedArea: false,
          });
        }
      }
    }

    // 4. Sort + dedupe + limit
    events.sort((a, b) => b.timestamp - a.timestamp);
    const seen = new Set();
    const deduped = events.filter((e) => {
      const key = `${e.type}_${e.propertyId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return NextResponse.json({
      events: deduped.slice(0, FEED_LIMIT),
      meta: {
        watchedSuburbCount: watchedSuburbs.length,
        likedCount: likedPropertyIds.size,
        lookbackDays: LOOKBACK_DAYS,
      },
    });
  } catch (err) {
    console.error('GET /api/buyer/feed error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
