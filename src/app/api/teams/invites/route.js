import { handleTeamRequest } from '../respond';
import { sendTeamInvite } from '../../services/teamService';

/**
 * POST /api/teams/invites  { email }
 * Any member of a team (or an agent with no team yet) invites ONE colleague from
 * their own office. The recipient is resolved server-side; the response never
 * reveals whether an email has an account.
 */
export async function POST(request) {
  return handleTeamRequest(request, async (auth) => {
    const { email } = await request.json().catch(() => ({}));
    return sendTeamInvite({ actorUid: auth.uid, actorEmail: auth.email, email });
  }, 'Send team invite');
}
