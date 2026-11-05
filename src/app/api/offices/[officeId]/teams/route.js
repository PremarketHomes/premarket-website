import { withOfficeAdmin } from './_handler';
import { listOfficeTeams, createOfficeTeam } from '../../../services/officeTeamAdminService';

/** GET /api/offices/{officeId}/teams — all teams of the office + agents with no team. Office-admin only. */
export const GET = (req, { params }) => withOfficeAdmin(req, params, ({ officeId }) => listOfficeTeams(officeId));

/** POST — body { name?, memberUids: [..>=2], adminUid }. Office-admin only. */
export const POST = (req, { params }) => withOfficeAdmin(req, params, ({ officeId, actorUid, body }) =>
  createOfficeTeam({ officeId, actorUid, name: body.name, memberUids: body.memberUids, adminUid: body.adminUid }));
