import { withOfficeAdmin } from '../../_handler';
import { moveOfficeTeamMember, removeOfficeTeamMember } from '../../../../../services/officeTeamAdminService';

/** PATCH /api/offices/{officeId}/teams/members/{uid} — body { toTeamId, confirmDissolve? }. Moves between teams. */
export const PATCH = (req, { params }) => withOfficeAdmin(req, params, ({ officeId, actorUid, params: p, body }) =>
  moveOfficeTeamMember({ officeId, actorUid, uid: p.uid, toTeamId: body.toTeamId, confirmDissolve: body.confirmDissolve === true }));

/** DELETE /api/offices/{officeId}/teams/members/{uid}?confirmDissolve=1 — removes from their team. */
export const DELETE = (req, { params }) => withOfficeAdmin(req, params, ({ officeId, actorUid, params: p, url }) =>
  removeOfficeTeamMember({ officeId, actorUid, uid: p.uid, confirmDissolve: url.searchParams.get('confirmDissolve') === '1' }));
