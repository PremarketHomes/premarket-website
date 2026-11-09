// Selling-agent search for the BSO combobox. Pure (no React), so it is unit-testable.

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();

/** "Phil Chillemi" / "invited" suffix for display in the input once chosen. */
export const agentLabel = (a) => `${a?.name || a?.email || ''}${a?.loginStatus === 'invited' ? ' (not logged in yet)' : ''}`;

/**
 * Case-insensitive, partial match on the agent's name (and email): every word typed must appear somewhere, so
 * "phil", "chil", "PHIL CHI" and "chillemi phil" all find Phil Chillemi. An empty query returns everyone.
 * Names that START with the query are listed first; otherwise the original (alphabetical) order is kept.
 */
export function filterAgents(agents, query) {
  const list = Array.isArray(agents) ? agents : [];
  const q = norm(query);
  if (!q) return list;
  const words = q.split(/\s+/);
  const hits = list.filter((a) => {
    const hay = `${norm(a.name)} ${norm(a.email)}`;
    return words.every((w) => hay.includes(w));
  });
  const starts = (a) => norm(a.name).startsWith(q) || norm(a.name).split(/\s+/).some((part) => part.startsWith(words[0]));
  return [...hits.filter(starts), ...hits.filter((a) => !starts(a))];
}
