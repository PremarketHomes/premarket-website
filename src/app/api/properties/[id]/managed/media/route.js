import { attachManagedMedia } from '../../../../services/managedCampaignService';
import { managedWrite } from '../_route';

/**
 * POST /api/properties/{id}/managed/media — body { urls: [...] }. Attaches photos already uploaded through /api/upload-image
 * (used by the background upload manager for campaigns the caller manages but does not own). Idempotent per URL.
 */
export const POST = managedWrite((db, { actorUid, propertyId, body }) => attachManagedMedia(db, { actorUid, propertyId, urls: body.urls }), 'Failed to add the photos');
