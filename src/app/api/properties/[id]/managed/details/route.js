import { updateManagedDetails } from '../../../../services/managedCampaignService';
import { managedWrite } from '../_route';

/**
 * PUT /api/properties/{id}/managed/details — body { property: {...} }. Owner, office admin or the managing BSO edits the
 * campaign details through the server (allowlisted fields only; ownership, management and billing cannot change). Audited.
 */
export const PUT = managedWrite((db, { actorUid, propertyId, body }) => updateManagedDetails(db, { actorUid, propertyId, input: body.property }), 'Failed to save the campaign');
