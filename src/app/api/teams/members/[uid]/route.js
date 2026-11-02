import { handleTeamRequest } from '../../respond';
import { removeTeamMember } from '../../../services/teamService';

/** DELETE /api/teams/members/{uid} — team creator or an office administrator only. */
export async function DELETE(request, { params }) {
  return handleTeamRequest(request, async (auth) => {
    const { uid } = await params;
    return removeTeamMember({ actorUid: auth.uid, targetUid: uid });
  }, 'Remove team member');
}
