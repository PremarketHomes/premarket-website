import { handleTeamRequest } from '../respond';
import { getTeamOverview } from '../../services/teamService';

/** GET /api/teams/mine — the caller's team, members, pending invitations. Read-only. */
export async function GET(request) {
  return handleTeamRequest(request, (auth) => getTeamOverview(auth.uid), 'Get my team');
}
