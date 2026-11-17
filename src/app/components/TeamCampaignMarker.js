import { knownTeamTheme, teamAccentStyle } from '../utils/teamTheme';

/**
 * Subtle team marker for a campaign row in the office lists (Office > Campaigns, the BSO workspace): a thin accent rule
 * down the row's left edge and a small team-name label. `theme` is the campaign summary's `teamTheme`, decided by the
 * server from the campaign's SELLING AGENT's verified team (services/teamThemes.js). With no theme — every other team and
 * agent — nothing renders and the row has no style attribute, so it looks exactly as before.
 */
export function teamRowStyle(theme) {
  return teamAccentStyle(knownTeamTheme(theme));
}

export function TeamAccentRule({ theme }) {
  if (!knownTeamTheme(theme)) return null;
  return <span className="absolute inset-y-0 left-0 w-[3px] bg-[var(--team-accent)]" aria-hidden="true" data-testid="team-accent-rule" />;
}

/** Its own small line under the selling agent's name (never inside a truncated line, so it is always visible). */
export function TeamLabel({ theme }) {
  const label = knownTeamTheme(theme) && typeof theme.label === 'string' ? theme.label : null;
  if (!label) return null;
  return (
    <p className="mt-1">
      <span
        className="inline-flex px-1.5 py-0.5 rounded-full text-[11px] font-semibold leading-none bg-[var(--team-accent-soft)] text-[var(--team-accent)] ring-1 ring-inset ring-[var(--team-accent-border)]"
        data-testid="team-label"
      >
        {label}
      </span>
    </p>
  );
}
