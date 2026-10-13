/**
 * POST /api/v1/track-engagement — superseded by /api/v1/engagement-ping
 * (see that file for why and for the full behaviour). Kept as a thin
 * alias only so any already-cached client bundle still calling this
 * path keeps working; the client code now calls the new path directly.
 */
export { POST } from '../engagement-ping/route';
