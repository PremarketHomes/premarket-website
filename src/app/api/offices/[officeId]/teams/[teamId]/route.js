import { withOfficeAdmin } from '../_handler';
import { updateOfficeTeam } from '../../../../services/officeTeamAdminService';

/** PATCH /api/offices/{officeId}/teams/{teamId} — body { name?, adminUid? }. Office-admin only. */
export const PATCH = (req, { params }) => withOfficeAdmin(req, params, ({ officeId, actorUid, params: p, body }) =>
  updateOfficeTeam({ officeId, actorUid, teamId: p.teamId, name: body.name, adminUid: body.adminUid }));
