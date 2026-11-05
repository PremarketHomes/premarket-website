import { NextResponse } from 'next/server';
import { describeEnvironment } from '../../services/environmentGuard';

/**
 * GET /api/internal/environment — which backend and which safeguards THIS deployment is running with.
 * Non-secret by design (project ids are already public in the browser config). Lets a deployment be verified before
 * anyone tests on it: serverProjectId must equal the project the browser is configured for, and a preview that
 * pointsAtLiveBackend must show previewWritesBlocked: true.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const info = describeEnvironment();
  return NextResponse.json({
    ...info,
    clientProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'premarket-homes (default)',
    clientMatchesServer: (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'premarket-homes') === info.serverProjectId,
    cdnBase: process.env.BUNNY_CDN_BASE || 'https://premarketvideos.b-cdn.net/ (default)',
  }, { headers: { 'cache-control': 'no-store' } });
}
