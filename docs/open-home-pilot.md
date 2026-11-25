# Open Home: live pilot (one agent)

A controlled live pilot of the Open Home experience, for a single allowlisted agent. The agent starts an open home
for one of their own campaigns from their dashboard. Buyers scan its QR code, check in on their own phone with no
Premarket login, optionally leave an anonymous price opinion and finish on the green screen. The agent sees
attendance and anonymous aggregates. The concept demo (`/concepts/open-home`) is unchanged and still demo-only.

## Who can use it
- `OPEN_HOME_PILOT_UIDS` in `src/app/api/services/openHomePilot.js` holds exactly one account. It was verified
  2026-11-25 by looking up its sign-in email: one Auth account, an agent in Harcourts Property Hub.
- Every agent route checks it on the server: Firebase ID token, then the allowlist, then ownership of the campaign or
  session.
- The dashboard link ("Open Home") only appears when `GET /api/open-home/pilot` says so. Other accounts see no link,
  get "not available" on the page, and receive 403 from every agent route.
- `OPEN_HOME_PILOT_TEST_UIDS` adds staging or emulator test agents. It is ignored whenever the server is connected to
  the live project.
- **Switch off:** remove the UID and deploy. The agent pages, and every QR code that agent issued, stop working
  immediately.

## Pages and routes
| | |
| --- | --- |
| `/dashboard/open-home` | Agent: choose a campaign → start a **live** or **test** open home → QR → live attendance and opinion totals → end → summary. Test open homes can be deleted. |
| `/dashboard/open-home/sign?session=…` | Printable entrance sign (A4, A3, A-frame, iPad), co-branded from the office's Premarket branding. |
| `/open-home/<code>` | Public buyer page, from the QR. No login. `noindex`. |
| `GET /api/open-home/pilot` · `GET campaigns` · `GET/POST sessions` · `GET/DELETE sessions/[id]` · `POST sessions/[id]/end` | Agent (signed in and allowlisted). |
| `GET visit/[code]` · `POST visit/[code]/check-in` · `POST …/opinion` · `POST …/interest` | Public, JSON only (a cross-site form can't post here). |

## Data: identity and opinions never meet
All collections are server-only (default-deny Firestore rules; verified against the deployed ruleset).

| Collection | Holds | Never holds |
| --- | --- | --- |
| `openHomeSessions/{code}` | campaign, agent, mode (live/test), start/end, slider range, check-in count | any buyer data |
| `openHomeAttendance/{random}` | name, mobile, email, marketing opt-in, notice version, check-in **minute**, interest (what they'd like) | any amount, opinion flag, device token |
| `openHomeOpinions/{code}` | **one** document: `amounts` (sorted) and `count` | buyer, attendance reference, device, any timestamp, arrival order |
| `openHomeOpinionGuards/{code}` | sorted SHA-256 hashes of random per-phone tokens (duplicate prevention only) | amounts, identity |
| `openHomeActive/{propertyId}` | the campaign's running session (one at a time, set atomically) | buyer data |

**The buyer's phone:**
- It sends the check-in (identity) and the opinion as separate requests, without cookies.
- The opinion request is `{ amount, device }` only. The check-in reference never goes with it, and the device token
  never goes with the check-in.
- The phone remembers its own progress, so the page can reopen where the buyer left off. It never stores the amount.

**The agent receives aggregates only** (`utils/openHome/opinionSummary.js`, shared with the concept):
- While the open home is live: an opinion count in steps of 5.
- After it ends: the typical opinion, the middle half and the spread, from 5 opinions. Fewer than 5 shows nothing.
- Never an individual amount, who gave one, or when.
- The completion screen looks the same whether or not an opinion was given.

**Register interest:**
- It updates the buyer's own check-in record and never carries an opinion.
- It is offered whether or not an opinion was given.

**Abuse and accidents:**
- One opinion per phone per open home (a repeat is ignored).
- Opinions are capped at the number of check-ins plus 2.
- Check-ins are capped at 250 per open home.
- Sessions expire after 12 hours.
- A Vercel preview connected to live data refuses every write.

**Residual risks (operator level, not agents):**
- Firestore keeps internal update times on documents.
- Vercel's platform logs keep request time and IP for both requests.
- So someone with database or hosting-log access, i.e. Premarket staff, could in principle try to correlate events.
  Nothing agent-facing exposes any of this.
- Keep log retention short and database access limited.
- With a single attendee and a single opinion, the opinion is obviously theirs to anyone with database access.
  Agents still see nothing below 5 opinions.

## Test mode
- Every test screen is labelled: the buyer's banner reads "Test open home · practice only".
- A test open home can be deleted with everything in it.
- Test and live data are stored the same way. Nothing from the pilot, test or live, goes into the campaign's existing
  opinions, report, emails or the iPad kiosk.

## What the pilot does NOT do (yet)
- No emails or SMS, to buyers or agents.
- Check-ins and interest are not copied into contacts or the CRM, or into the campaign report or registration
  notifications. They stay in the Open Home view. This keeps the pilot out of `offers`, where the existing kiosk and
  campaign page store a registration on the same document as the opinion.
- No vendor-facing report. The dashboard updates by polling every 6 seconds, not push.
- The privacy notice and consent wording should still be reviewed before a wider rollout.

## Existing behaviour unchanged
`offers`, the campaign page, reports, dashboards (apart from one link for the allowlisted account), the iPad kiosk,
billing and permissions are untouched. Firestore rules are unchanged; the new collections fall under the existing
default deny.
