import { knownTeamTheme } from './teamTheme';

const CHUNK = 25; // = MAX_THEME_PROPERTY_IDS / the public id-list cap
const cache = new Map(); // propertyId -> Promise<theme|null>, per page load

async function load(ids) {
  try {
    const res = await fetch(`/api/public/campaign-theme?ids=${encodeURIComponent(ids.join(','))}`);
    if (!res.ok) return {};
    return (await res.json()).themes || {};
  } catch {
    return {};
  }
}

/**
 * { [propertyId]: theme | null } — each campaign's team accent palette (see utils/teamTheme.js), decided by the
 * server from the campaign's selling agent and team. Display only and never throws: any failure is "no theme", so
 * the page keeps its normal colours. Only palettes known to this build are returned.
 */
export async function fetchCampaignThemes(propertyIds) {
  const ids = [...new Set((propertyIds || []).filter((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(id)))];
  const missing = ids.filter((id) => !cache.has(id));
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    const request = load(chunk);
    chunk.forEach((id) => cache.set(id, request.then((themes) => knownTeamTheme(themes[id]))));
  }
  const entries = await Promise.all(ids.map(async (id) => [id, await cache.get(id)]));
  return Object.fromEntries(entries);
}
