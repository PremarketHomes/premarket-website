import { reassignManager } from '../../../../services/managedCampaignService';
import { managedWrite } from '../_route';

/**
 * POST /api/properties/{id}/managed/manager — body { managerUid }. Office admin only: hands management of the campaign to
 * one of the office's BSOs (or an office admin). The selling agent, original creator and billing never change. Audited.
 */
export const POST = managedWrite((db, { actorUid, propertyId, body }) => reassignManager(db, { actorUid, propertyId, managerUid: body.managerUid }), 'Failed to change the campaign manager');
