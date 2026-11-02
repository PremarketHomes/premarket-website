import { handleTeamRequest } from '../../respond';
import { respondToInvite } from '../../../services/teamService';

/**
 * POST /api/teams/invites/{id}  { action: 'accept' | 'decline' | 'cancel' }
 * accept/decline: only the invited account. cancel: the sender or a member of
 * the sending team.
 */
export async function POST(request, { params }) {
  return handleTeamRequest(request, async (auth) => {
    const { id } = await params;
    const { action } = await request.json().catch(() => ({}));
    return respondToInvite({ inviteId: id, actorUid: auth.uid, action });
  }, 'Respond to team invite');
}
