import { withOfficeAdmin } from '../../_handler';
import { addOfficeTeamMember } from '../../../../../services/officeTeamAdminService';

/** POST /api/offices/{officeId}/teams/{teamId}/members — body { uid }. Adds an agent who has no team. */
export const POST = (req, { params }) => withOfficeAdmin(req, params, ({ officeId, actorUid, params: p, body }) =>
  addOfficeTeamMember({ officeId, actorUid, teamId: p.teamId, uid: body.uid }));
