'use client';

import { useEffect, useState } from 'react';
import { isPreviewDeployment } from '../../utils/previewEnvironment';

/**
 * Visible only on a Vercel Preview deployment (*.vercel.app) — never on
 * premarket.homes. Makes it unmistakable to a tester that price opinions,
 * registrations and view counts on this page are simulated, not written
 * to the real production Firestore project the preview shares with
 * production (see utils/previewEnvironment.js for why that sharing
 * exists and can't easily be avoided without new infrastructure).
 *
 * Checked in an effect (not at render time) so this never affects the
 * server-rendered/static HTML — it only ever appears client-side, after
 * hydration, exactly when the real hostname is known.
 */
export default function PreviewModeBanner() {
  const [isPreview, setIsPreview] = useState(false);

  useEffect(() => {
    setIsPreview(isPreviewDeployment());
  }, []);

  if (!isPreview) return null;

  return (
    <div className="bg-amber-400 text-amber-950 text-xs sm:text-sm font-semibold text-center py-2 px-4">
      Preview mode — price opinions, registrations and view counts are simulated and not saved.
    </div>
  );
}
