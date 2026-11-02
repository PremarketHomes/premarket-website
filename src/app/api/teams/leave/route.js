import { handleTeamRequest } from '../respond';
import { leaveTeam } from '../../services/teamService';

/** POST /api/teams/leave — the caller leaves their own team. */
export async function POST(request) {
  return handleTeamRequest(request, (auth) => leaveTeam({ actorUid: auth.uid }), 'Leave team');
}
