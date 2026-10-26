/**
 * Loads the public profile fields for a set of agent/owner uids from
 * /api/public/agent-profiles. Returns { [uid]: profile }; an agent that
 * can't be resolved is simply absent, matching the old per-doc behaviour
 * where a failed read left that agent out.
 */
export async function fetchAgentProfiles(uids) {
  const ids = [...new Set((uids || []).filter(Boolean))];
  const profiles = {};
  for (let i = 0; i < ids.length; i += 25) {
    try {
      const res = await fetch(`/api/public/agent-profiles?ids=${ids.slice(i, i + 25).join(',')}`);
      if (res.ok) Object.assign(profiles, (await res.json()).profiles);
    } catch (err) {
      console.error('Error fetching agent profiles:', err);
    }
  }
  return profiles;
}
