/**
 * Automatic photo compression is PAUSED unless IMAGE_COMPRESSION_ENABLED is exactly 'true'.
 *
 * Covers the 15-minute cron (/api/cron/compress-images), the post-upload trigger (/api/images/compress) and the backfill
 * flagger (/api/images/backfill-compress). Compression rewrites a listing's imageUrls (and its draft) to new Bunny copies.
 * While legacy photos are preserved and migrated off Firebase Storage (incident, Nov 2026), nothing may rewrite those
 * references automatically. Photos still display normally while paused; new uploads just keep their original file.
 *
 * To resume: set IMAGE_COMPRESSION_ENABLED=true in Vercel and redeploy.
 */
export const imageCompressionEnabled = (env = process.env) => env.IMAGE_COMPRESSION_ENABLED === 'true';

export const PAUSED_MESSAGE = 'Image compression is paused.';
