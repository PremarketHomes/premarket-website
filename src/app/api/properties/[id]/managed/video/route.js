import { setManagedVideo } from '../../../../services/managedCampaignService';
import { managedWrite } from '../_route';

/**
 * POST /api/properties/{id}/managed/video — body { videoUrl: "<download link>" | null }. Attaches (or removes) the video of a
 * campaign the caller manages but does not own. The file itself is uploaded by the browser to Firebase Storage, exactly like
 * an agent's own video; the link must point to the caller's own upload for this campaign.
 */
export const POST = managedWrite(
  (db, { actorUid, propertyId, body }) => setManagedVideo(db, { actorUid, propertyId, videoUrl: body.videoUrl === null ? null : body.videoUrl }),
  'Failed to update the video',
);
