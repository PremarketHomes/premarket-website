import { isAgent } from '../../utils/roles';
import { knownTeamTheme, MITCH_HARROP_PINK } from '../../utils/teamTheme';
import { LIVE_PROJECT_ID, backendProjectId, pointsAtLiveBackend } from './environmentGuard';

/**
 * Team accent themes (display only) — which existing team, by TEAM ID, gets which palette (utils/teamTheme.js).
 *
 * Nothing is stored or written: no new collection, no field on the team, campaign or user. The team structure
 * stays exactly as it is (`teams/{id}` + the single `users/{uid}.teamId` pointer, see teamService.js).
 *
 * How a CAMPAIGN's team is decided — campaign ownership, never the uploader or whoever is viewing:
 *   - the campaign's SELLING AGENT is resolved by the same rule as the buyer page and Office > Campaigns
 *     (managedCampaignService.sellingAgentOf / publicProfileService.getAssignedAgentProfile):
 *       · normally the owner, `property.userId` (for a managed campaign that is the selling agent the BSO or office
 *         admin chose; the uploader is `createdByUid` and plays no part);
 *       · for an older roster-assigned listing (`agentId`, "uploaded under my account for someone else") it is the
 *         UNIQUE agent in the owner's office with exactly that name. `userId` is then the uploader, so it is never
 *         used; no unique match = no theme, never a guess.
 *   - the campaign's team is that agent's ONE team (`users.teamId`; an agent can't be in two teams), and it only
 *     counts while the team doc exists in the agent's CURRENT office and that office is active — so a stale pointer,
 *     leaving the team, or leaving the office ends the theme immediately.
 *
 * Changing this list is a code change on purpose (reviewed, in git history), like testCampaigns.js.
 */
export const TEAM_THEME_ASSIGNMENTS = Object.freeze({
  // "Mitch Harrop Team", Harcourts Property Hub (office ioxigzf4hcRtowqL4C94). Verified read-only on 2026-11-17: the only
  // team with that name, in the HPH office, 7 members including Mitch Harrop; no team logo or colours configured.
  ICSKK5kDs5RF5OYs11mM: MITCH_HARROP_PINK.key,
});

/**
 * The assignments in force. A non-production test team (TEAM_THEME_TEST_TEAM_ID, given the Mitch Harrop palette) is
 * honoured ONLY when the server is not the live project (staging / emulator), exactly like PROMO_TEST_OFFICE_ID, so it
 * can never theme a real team in production.
 */
export function activeTeamThemeAssignments(env = process.env) {
  const testId = env.TEAM_THEME_TEST_TEAM_ID;
  if (testId && backendProjectId(env) !== LIVE_PROJECT_ID && !pointsAtLiveBackend(env)) {
    return { ...TEAM_THEME_ASSIGNMENTS, [testId]: MITCH_HARROP_PINK.key };
  }
  return TEAM_THEME_ASSIGNMENTS;
}

const has = (obj, k) => typeof k === 'string' && k.length > 0 && Object.prototype.hasOwnProperty.call(obj, k);

/** The palette key assigned to a team id, or null. Callers must have verified the team themselves (see below). */
export function themeForTeamId(teamId, assignments = activeTeamThemeAssignments()) {
  if (!has(assignments, teamId)) return null;
  const palette = knownTeamTheme({ key: assignments[teamId] });
  return palette ? { key: palette.key } : null;
}

const normName = (n) => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();
const fullName = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`;
export const MAX_THEME_PROPERTY_IDS = 25;

/**
 * { [propertyId]: { key } | null } for public campaign pages and campaign cards. Pure reads via the injected Admin
 * SDK `db`; per-call caches keep it to a handful of reads. With no team assigned it does no reads at all.
 */
export async function resolveCampaignTeamThemes(db, propertyIds, { assignments = activeTeamThemeAssignments() } = {}) {
  const ids = [...new Set(propertyIds || [])].slice(0, MAX_THEME_PROPERTY_IDS);
  const out = Object.fromEntries(ids.map((id) => [id, null]));
  const themedTeamIds = Object.keys(assignments);
  if (!ids.length || !themedTeamIds.length) return out;

  const memo = new Map();
  const once = (key, load) => {
    if (!memo.has(key)) memo.set(key, load());
    return memo.get(key);
  };
  const data = (snap) => (snap && snap.exists ? snap.data() : null);
  const getDoc = (col, id) => once(`${col}/${id}`, () => db.collection(col).doc(id).get().then(data));

  // The offices the themed teams live in: a roster-assigned listing elsewhere can't resolve to one of them, so it
  // never needs the office-wide name lookup.
  const themedOffices = once('themedOffices', async () => {
    const teams = await Promise.all(themedTeamIds.map((t) => getDoc('teams', t)));
    return new Set(teams.filter(Boolean).map((t) => t.officeId).filter(Boolean));
  });

  const uniqueAgentByName = (officeId, name) => once(`byName/${officeId}/${normName(name)}`, async () => {
    const people = await once(`officeUsers/${officeId}`, () => db.collection('users').where('officeId', '==', officeId).get());
    const matches = people.docs.filter((d) => isAgent(d.data()) && normName(fullName(d.data())) === normName(name));
    return matches.length === 1 ? { uid: matches[0].id, user: matches[0].data() } : null;
  });

  const sellingAgentOf = async (p) => {
    if (!p?.userId) return null;
    if (!p.agentId) {
      const user = await getDoc('users', p.userId);
      return user ? { uid: p.userId, user } : null;
    }
    if (!normName(p.agentName)) return null;
    const owner = await getDoc('users', p.userId);
    const officeId = owner?.officeId;
    if (!officeId || !(await themedOffices).has(officeId)) return null;
    return uniqueAgentByName(officeId, p.agentName);
  };

  const teamThemeOf = async (agent) => {
    const u = agent?.user;
    if (!u || !u.officeId || !has(assignments, u.teamId)) return null;
    const team = await getDoc('teams', u.teamId);
    if (!team || team.officeId !== u.officeId) return null; // stale pointer: team gone or agent moved office
    const office = await getDoc('officeAdminInfo', u.officeId);
    if (!office || office.status !== 'active') return null;
    return themeForTeamId(u.teamId, assignments);
  };

  await Promise.all(ids.map(async (id) => {
    try {
      const p = await getDoc('properties', id);
      out[id] = await teamThemeOf(await sellingAgentOf(p));
    } catch (err) {
      console.error('team theme lookup failed (non-fatal):', err?.message || err);
      out[id] = null;
    }
  }));
  return out;
}
