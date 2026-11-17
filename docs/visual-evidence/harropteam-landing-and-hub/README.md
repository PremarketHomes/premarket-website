# Mitch Harrop Team: vendor page + Agent Hub accents (evidence)

These screens come from a local production build of this branch on the STAGING project, using fake accounts. The vendor page needs no data. For the Agent Hub, the signed-in "Mitch Harrop Team member" is a fake staging agent in a staging copy of the team, which uses the real team id (`ICSKK5kDs5RF5OYs11mM`).

Automated checks (`e2e/harrop-check.js`): **26/26 passed**.

**Vendor page (`/hph`, `/harropteam`, `/Harropteam`), desktop and phone:**
- every page returns 200 and keeps the URL as typed;
- the accent is HPH blue `#00AEEF` on `/hph` and Mitch pink `#FA5DB5` on both team URLs;
- the Harcourts Property Hub logo is kept;
- page text is identical line for line, except the two team lines on the team page ("Mitch Harrop Team · In partnership with Premarket" and "Mitch Harrop Team" under the closing logo);
- `/Harropteam` serves the same content as `/harropteam`.

**Agent Hub:**
- signed-out visitors, agents in another team and agents with no team see HPH blue;
- the verified Mitch Harrop Team member sees pink (eyebrows and the selected tab).

| # | Screen |
|---|---|
| 01 / 02 | Vendor page hero, desktop: /hph vs /Harropteam |
| 03 / 04 | Vendor page hero, phone: /hph vs /Harropteam |
| 05 / 06 | Closing section: /hph vs /Harropteam |
| 07 | Agent Hub, signed out (unchanged) |
| 08 / 09 | Agent Hub, verified Mitch Harrop Team member (desktop / phone) |
| 10 | Agent Hub, agent in another team (unchanged) |
