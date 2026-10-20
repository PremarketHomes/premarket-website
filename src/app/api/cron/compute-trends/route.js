import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { verifyCron } from '../../middleware/auth';
import {
  getUniqueSuburbs,
  computeSuburbScores,
  writeTrendToFirestore,
  suburbKey,
} from '../../v1/scoreComputation';

export const maxDuration = 300;

export async function GET(request) {
  const auth = verifyCron(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const suburbs = await getUniqueSuburbs();
    let computed = 0;
    let skipped = 0;

    for (const s of suburbs) {
      try {
        const scores = await computeSuburbScores(s.suburb, s.state, s.lat, s.lng);
        if (scores) {
          const trendKey = `${s.key}_${monthKey}`;
          await writeTrendToFirestore(trendKey, s.suburb, s.state, monthKey, scores);
          computed++;
        } else {
          skipped++;
        }
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'compute-trends', suburbKey: s.key } });
        console.error(`Failed to compute trend for ${s.key}:`, err);
        skipped++;
      }
    }

    return NextResponse.json({
      success: true,
      monthKey,
      totalSuburbs: suburbs.length,
      computed,
      skipped,
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'compute-trends' } });
    console.error('Compute trends cron error:', err);
    return NextResponse.json({ error: 'Failed to compute trends' }, { status: 500 });
  }
}
