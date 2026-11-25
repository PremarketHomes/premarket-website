# Open Home: live pilot (one agent)

A controlled live pilot of the Open Home experience, for a single allowlisted agent. The agent starts an open home
for one of their own campaigns from their dashboard. Buyers scan its QR code, check in on their own phone with no
Premarket login, optionally leave an anonymous price opinion and finish on the green screen. The agent sees
attendance live, and the anonymous opinions once the open home ends. The concept demo (`/concepts/open-home`) is
unchanged and still demo-only (it keeps the earlier "combined results from 5 opinions" rule).

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
| `/dashboard/open-home` | Agent: choose a campaign → start a **live** or **test** open home → QR → live attendance (opinions sealed) → end → every opinion amount, count, average and range. Test open homes can be deleted. |
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

**What the agent receives** (`utils/openHome/opinionReveal.js`, open homes started from 25 Nov 2026):
- While the open home is running: **nothing** about opinions. No count and no price, on screen or in the API
  response, so no change on the agent's screen can be matched to the buyer who just walked out.
- After it ends (or expires after 12 hours): **every amount**, lowest to highest, with the count, the average (to the
  nearest $1,000) and the range. This applies from a single opinion, because many open homes only see one to three
  groups.
- Each result carries a caveat. One opinion is "one buyer's opinion … not a statistically reliable valuation"; 2–4
  opinions are "a small sample"; 5 or more are "a guide to buyer perception, not a valuation".
- Never who gave an opinion, the order opinions came in, or when.
- No opinion is accepted once the open home has ended. Otherwise a late opinion would change a summary the agent has
  already seen, and give that buyer away.
- **Open homes started under the earlier notice** (`open-home-pilot-2026-11`, before this change) keep the rule
  their buyers were shown. Agents get combined results only, from 5 opinions (`utils/openHome/opinionSummary.js`). A
  session's notice version is fixed when it starts, so changing the rule never re-labels opinions already given.

**What the buyer is told** (beside the slider, before they choose): "Anonymous: your name isn't attached. Your opinion
is sent on its own, with no name, number, email or time. When the open home ends, {agent} sees each amount given,
lowest to highest, but never who gave which. If only a few people visit, they may be able to guess." The green
completion screen is word for word the same whether or not an opinion was given.

**Register interest:**
- It updates the buyer's own check-in record and never carries an opinion.
- It is offered whether or not an opinion was given.

**Abuse and accidents:**
- One opinion per phone per open home (a repeat is ignored).
- Opinions are capped at the number of check-ins plus 2 (anything over the cap is ignored).
- The opinion endpoint gives the **same answer** (`{ ok: true }`) whether the opinion was recorded, was a repeat, or
  was over the cap. Nobody holding the QR link can probe how many opinions are in.
- Check-ins are capped at 250 per open home.
- Sessions expire after 12 hours.
- When many phones submit at once, check-in and opinion transactions retry up to 12 times. The phone also resends an
  opinion after a dropped connection or server error. That is safe because each phone can record only one opinion.
- A Vercel preview connected to live data refuses every write.

## Identification risks, especially with few opinions

Anonymity here means that **no record, screen, report or log Premarket produces says who gave which opinion**. It does
not mean that nobody could ever work it out. The remaining limits:

**What the agent could infer (the new risk from showing small numbers):**
- **Elimination.** If one person attends and one opinion is shown, it is theirs. If three attend and three opinions are
  shown, the agent knows the set of amounts but not who gave which. If a buyer tells the agent their figure, the other
  figures narrow down. Showing exact amounts makes this possible, and no technical measure can prevent it. Mitigations:
  buyers are told before they choose, the agent sees a request to treat opinions as anonymous, and nothing is shown
  until the end.
- **Ending and restarting.** An agent who deliberately ends the open home after each group, then starts a new one with
  a new QR code, would see each group's opinions separately. Every session appears in the agent's history, which
  Premarket can review. This is a matter of policy, not something the code blocks.
- **Timing.** This is **not** available to the agent. Opinions are sealed while the open home runs, so nothing changes
  on screen when one arrives. The amounts after the end are sorted and carry no time. The attendance register shows
  check-in to the minute only, and nothing about opinions.

**What Premarket staff with production database or hosting access could in principle do (unchanged by this rule):**
- The database always held every amount. The earlier 5-opinion minimum was a display rule only, so removing it adds
  no operator-level risk.
- **Firestore version retention.** Checked read-only on 2026-11-25: point-in-time recovery is **off**, and version
  retention is the default **1 hour**. For up to an hour after each opinion, someone with admin database credentials
  could read earlier versions of the session's opinions document and see which amount was added when. After an hour
  that history is gone.
- **Firestore audit logs.** Data Access audit logs are not enabled for Firestore (only Storage writes are logged), so
  Google's logs do not hold opinion writes.
- **Document timestamps.** Firestore keeps internal create and update times on documents. A check-in's exact time is
  in its metadata even though the stored field is rounded to the minute. The opinions document's update time is the
  time of the last opinion.
- **Vercel request logs** keep the time, path (which includes the session code), IP address and browser for each
  check-in and opinion request, but no request bodies or amounts. Matching a check-in and an opinion from the same IP
  is possible. Getting the amount as well would need the database version history above, inside its one-hour window.
- **Backups.** The manual encrypted Firestore exports would capture whatever list existed at the moment they ran.
- **Mitigations:** keep production database and Vercel log access to as few people as possible, keep log retention
  short, and don't enable point-in-time recovery or Firestore data-access logging without considering this.

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
- Opinions sent after the agent presses End are not recorded (see above). Agents should end the open home once the
  last group has left.
- The privacy notice and consent wording should still be reviewed before a wider rollout.

## Existing behaviour unchanged
`offers`, the campaign page, reports, dashboards (apart from one link for the allowlisted account), the iPad kiosk,
billing and permissions are untouched. Firestore rules are unchanged; the new collections fall under the existing
default deny.
