# Mitch Harrop Team accent — visual evidence

## Production team (verified read-only, 2026-11-17)
- Team id **`ICSKK5kDs5RF5OYs11mM`**, name "Mitch Harrop Team". It is the only team with that name. It is in the Harcourts Property Hub office (`ioxigzf4hcRtowqL4C94`), and the office has 14 teams.
- It has 7 members, including Mitch Harrop. There are no stale team pointers.
- No team-level or member logo or colours are configured. The only agency brand is the HPH office brand (navy + logo).
- Campaign relationships: **0 of 102** production listings are owned, created, managed or assigned to a team member today.
- The real resolver was run read-only over all 102 production listings with the shipped id: **0 themed**, so nothing changes on any existing campaign.
- In-memory controls against the real team, office and user records:
  - a campaign owned by a member → pink
  - a BSO upload for Mitch Harrop → pink
  - another HPH team's campaign → unchanged
  - a member uploading for a no-team agent → unchanged

## Screens (local build of this branch on the STAGING project, fake data)
- **Shipped config only.** No test override was used. Staging holds a fake team with the **same id** (fake members), so the real config entry drives everything.
- **BSO campaigns.** A fake staging BSO created them through the **real managed-campaign API**: owner = team agent, creator/manager = BSO. It then published them with the real "show" action.
- **Office colours.** The staging office was given HPH's navy so other teams look like production HPH.
- **Kiosk.** It ran with `demo=1`, so nothing was saved or sent.

| # | Screen | Campaign / viewer | Expected | Result |
|---|---|---|---|---|
| 01 | Buyer page, desktop (slider moved) | BSO-uploaded campaign of a Mitch team agent | pink | ✅ |
| 02 | Buyer page, desktop | other HPH team | navy (unchanged) | ✅ |
| 03 | Confirmation dialog, desktop | Mitch team | pink | ✅ |
| 04–05 | Buyer page + confirmation, phone 390px | Mitch team | pink | ✅ |
| 06 | Buyer page, phone | other HPH team | navy | ✅ |
| 07–08 | iPad kiosk, landscape (idle, approve step) | Mitch team | pink ring + approve button, photo neutral | ✅ |
| 09 | iPad kiosk, portrait | Mitch team | pink | ✅ |
| 10 | iPad kiosk, landscape | other HPH team | navy (unchanged) | ✅ |
| 11 | Dashboard | Mitch team member | pink nav, Add Property, card accent | ✅ |
| 12 | Dashboard menu, phone | Mitch team member | pink nav highlight | ✅ |
| 13 | My Team page (My properties tab) | Mitch team member | pink accents + campaign row marker | ✅ |
| 14 | Dashboard | another team's member | orange (unchanged) | ✅ |
| 15 | Dashboard | agent with no team | orange (unchanged) | ✅ |
| 16 | BSO workspace | the uploading BSO (not in the team) | standard chrome; only rows whose **selling agent** is in the team get the thin pink rule + "Mitch Harrop Team" label | ✅ |
| 17 | Office › Campaigns (office admin) | whole office | neutral page; only the team's 2 campaigns marked; other teams, no-team agents and an admin-account upload for another team's agent unmarked | ✅ |
| 18–19 | Office › Campaigns + BSO workspace, phone | as above | label on its own line, fully visible | ✅ |

List checks (scratchpad `e2e/visual-lists.js`): **16/16 passed**. They cover the marked rows being exactly the team's campaigns, the pink rule + label colour, the label being fully visible (not truncated) on desktop and phone, and every other row having no rule, no label and no style.

Automated computed-colour checks (scratchpad `e2e/visual-final.js`): **42/42 passed**. They include the BSO-uploaded campaign of a never-logged-in team agent (pink), and the kiosk approve → thank-you staying on the same single page.
