# Mitch Harrop Team accent — visual evidence

Captured 2026-11-17 against a **local build of this branch on the STAGING Firebase project** (fake data only; no
production data was read or written). `stg_team1` stands in for the Mitch Harrop Team via `TEAM_THEME_TEST_TEAM_ID`,
which the server ignores whenever it points at the live project. The staging office was given HPH's navy colours so
"not themed" pages look like production HPH. The kiosk ran with `demo=1` (nothing saved or sent).

| # | Screen | Campaign / viewer | Expected | Result |
|---|---|---|---|---|
| 01 | Buyer page, desktop (slider moved) | themed-team agent's campaign | pink | ✅ |
| 02 | Buyer page, desktop | **other HPH team** | navy (unchanged) | ✅ |
| 03 | Confirmation dialog, desktop | themed | pink | ✅ |
| 04–05 | Buyer page + confirmation, phone 390px | themed | pink | ✅ |
| 06 | Buyer page, phone | other team | navy | ✅ |
| 07–08 | iPad kiosk, landscape (idle, approve step) | themed | pink slider ring + approve button, photo neutral | ✅ |
| 10 | iPad kiosk, portrait | themed | pink | ✅ |
| 11 | iPad kiosk, landscape | other team | navy (unchanged) | ✅ |
| 12 | Dashboard | themed-team member | pink nav highlight, Add Property, card accents | ✅ |
| 13 | Dashboard menu, phone | themed-team member | pink nav highlight | ✅ |
| 14 | My Team page | themed-team member | pink accents, team rows marked | ✅ |
| 15 | Dashboard | agent with no team | orange (unchanged) | ✅ |
| 16 | Dashboard | office admin (no team) owning a listing assigned to a themed member | orange chrome, that one card pink | ✅ |

Automated colour checks (computed styles, scratchpad `e2e/visual-theme.js`): **40/40 passed**, including
- managed campaign uploaded by a BSO for a themed-team agent → pink (follows the selling agent)
- campaign uploaded **by** a themed-team member **for** a no-team agent → not themed (uploader ignored)
- older roster-assigned listing (uploaded under an admin account, assigned to a themed member) → pink
- kiosk approve → thank-you stays on the same single page (`mode=ipad`), no extra step
