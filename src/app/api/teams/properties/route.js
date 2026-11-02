import { handleTeamRequest } from '../respond';
import { listTeamProperties } from '../../services/teamService';

/**
 * GET /api/teams/properties — teammates' listings as minimal READ-ONLY rows
 * (no offers, buyer data or billing). Membership is re-validated per request.
 * The full report opens through /api/properties/{id}/report at team level.
 */
export async function GET(request) {
  return handleTeamRequest(request, (auth) => listTeamProperties(auth.uid), 'List team properties');
}
