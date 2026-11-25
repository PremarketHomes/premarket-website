# Buyer privacy: price opinions and registrations are kept apart

Premarket promises buyers that their price opinions are anonymous. This document covers four things:

- how buyer data flows today
- what was wrong
- what was changed
- what limits remain

## The data flow (after this change)

| Step | What is stored | Where |
|---|---|---|
| Buyer opens a campaign | A view counter, plus a per-visit record (random device id, user agent, time) | `properties.stats`, `propertyViews`, `propertyViewSessions` (server-only) |
| Buyer gives a price opinion | **Anonymous record:** amount, the tab's random session id, campaign, times | `offers` (type `opinion`) |
| Buyer registers interest | **Separate record:** name, email, phone, answers, optional linked account. No price, session id or device id | `offers` (type `opinion`, `serious: true`) |
| Agent is told about a registration | Email with the buyer's details and answers (no price) | `/api/offers/notify-interest`, Resend |
| Engagement (time on page, photos) | Its own random id per page view; no account and no opinion id | `propertyEngagement` |
| Analytics (Google Tag Manager → GA4) | Event name plus campaign details only (`property_id`, title, address, listing price, path) | `dataLayer` |
| iPad kiosk | Same split: the opinion and the registration get different ids | `offers` |
| TV display | Same split: the opinion is anonymous, and a new account creates its own registration | `offers` |
| Open Home pilot | Already separate: check-ins (identity) and one sorted list of amounts per session, never linked | `openHome*` (unchanged) |

Agents and offices see:

- **Reports:** produced by the server only (`/api/properties/[id]/report`, `opinionPrivacy.js`). Anonymous amounts, and registrations without prices.
- **Dashboard total:** a number from `/api/offers/opinion-counts`.

They can no longer read raw `offers` records from the browser.

## Problems found (before this change)

1. **Analytics.**
   - The buyer page pushed `opinion_amount` (and `session_id` on create and update) into the Google Tag Manager `dataLayer` with every opinion event.
   - The `session_id` was the same value stored on the opinion record, which could also hold the buyer's registration.
   - The live GTM container (GTM-PS65V87) has GA4 tags set up to send `opinion_amount` together with `register_interest`, `user_id` and buyer type, on four event names: `price_opinion_submitted`, `price_opinion_adjusted`, `qualification_form_submitted` and `signup_completed`.
   - The current site does not emit those event names. The amounts were still in the page's `dataLayer`, where any tag could read them, and older versions may have sent them.
2. **Same record.** Registering after giving a price added the buyer's name, email, phone (and account) onto the opinion record itself. The iPad kiosk did the same (it reused the opinion's id), and the TV display linked the new account onto the opinion.
3. **Raw read access.**
   - Firestore rules let the listing agent read raw `offers` records from the browser, including older records holding a buyer's details next to their price.
   - The agent dashboard did exactly that, just to count opinions.
   - The report itself was already separated on the server, but the browser route bypassed it.
4. **Device id.**
   - The persistent device id (`pm_visitor_id`) was stamped on every new opinion and every registration.
   - That would let a registration on one campaign be joined to "anonymous" opinions the same device gave on other campaigns.

Live data, counted read-only on 25 Nov 2026 (counts only):

- 157 opinion records in total.
- **10 records in 7 campaigns hold a price together with buyer identity.** 7 of those 10 are linked by an account only.
- 45 priced records carry the device id.
- The TV display has never been used.

## What changed

- **Analytics allowlist** (`utils/analyticsEvents.js`).
  - The buyer page can only send `property_id`, `property_title`, `property_address`, `property_price` and `page_path`. Anything else is dropped, so an amount, session id, device id or buyer detail can never reach GTM, even by mistake later.
  - Event names are kept for funnel counts.
- **Separate records** (`utils/opinionRecords.js`).
  - A registration is its own record: buyer details and answers, with no price, session id or device id.
  - The buyer page, the iPad kiosk and the TV display all use `registrationRecord(...)`.
  - New opinions carry no device id.
  - A slider value the buyer never submitted is no longer saved when they register. It used to be stored on the registration; saving it now as an "anonymous" opinion in the same second as a named registration would tie them together by time.
- **Rules** (`firestore.rules`).
  - Any client-written record that holds buyer details (name, email, phone, account or `serious`) must be a serious registration with no price, session id or device id.
  - Any record without buyer details cannot gain them.
  - Older combined records can no longer be edited by any client.
  - Raw `offers` reads are limited to the buyer's own linked registration and superAdmins.
  - No new field was needed, so the new app works under today's rules as well.
- **Counts** (`countsAsOpinion`). A registration stored on its own is a registration, not an opinion, so a buyer who gives a price and registers is counted once.
  - Applies to: the report, the agent dashboard total, team, BSO and leadership views, the shareable card, the buyer page's count, the admin Properties tab and the CRM contact counts.
  - Older records count exactly as before. For example, Worongary stays at 9 = 8 prices + 1 registration.
- **Report wording.**
  - The breakdown bar now reads "Registered" and "Anonymous price opinions"; the two can overlap.
  - The serious/passive median note says a registered buyer's price is never known.
  - Serious/passive medians are only possible from older combined records, and only with 3 or more in each group.
- **Sentry replay.** Masking of all text and inputs, blocked media and no captured request bodies are now stated explicitly, so a future SDK default cannot change them.

## Downstream checks

| System | Depends on the old shape? | Result |
|---|---|---|
| Report, emailed report, team, leadership, BSO | Registrations are `serious` records; prices are amounts | Works; counts use `countsAsOpinion` |
| Agent registration email (`notify-interest`) | Reads the registration record by id | Works; it is now sent for the registration record (no price) |
| CRM contacts (`contactComputation`) | Registrations by email or phone | Works; a separate registration no longer counts as one of the buyer's "price opinions" |
| Buyer dashboard (`useBuyerData`) | The buyer's own records by `userId` | Works; lists their registrations. It never displayed the amount (field mismatch, unchanged) |
| Buyer profiles, office registration list | `serious` records with `userId`, or an allowlist without the amount | Works unchanged |
| `/api/v1` scoring, market report, buyer feed | Count records as activity | Unchanged (internal signals). A separate registration counts as one more activity record |
| Cloud Functions repo (`onSeriousOfferCreated`, report emails) | Would read `offers` | **Not running.** The Cloud Functions API is disabled on the live project. If ever re-enabled, its legacy report computes a serious median without a minimum group and must be reviewed first |
| Email/SMS channel attribution (separate PR) | Counts only; never writes to `offers` | Works; it refuses to process any record carrying buyer details |

## Remaining limitations (stated plainly)

- **Historical records are unchanged.**
  - 10 older records (7 campaigns) still hold a price next to buyer identity, and 45 priced records carry the device id.
  - Reports separate them, and agents can no longer read them raw. superAdmins and anyone with database access still can.
  - Splitting or scrubbing them would rewrite production data and needs explicit approval. A plan:
    - copy each combined record's buyer fields into a new registration record (no price, no ids), then remove those fields from the original
    - remove `visitorId` from opinion records
    - run it as a reviewed, logged script with a backup first
- **Timing.**
  - When a buyer submits a price and then registers a minute later, the agent gets the registration email and, if they refresh the report, sees one new amount at about the same time.
  - With few buyers, that can suggest whose price it is. The same applies to anyone with database access, by comparing record times.
  - The Open Home pilot avoids this by sealing opinions until the end.
  - Options, not built: delaying or batching the report's amount list, or sealing opinions while a campaign is quiet.
- **Privileged access.**
  - superAdmins can read raw records from the browser, and anyone with Admin SDK or console access can read everything.
  - Firestore keeps old document versions for 1 hour (point-in-time recovery is off).
  - Vercel request logs carry IP addresses and paths.
  - Sentry receives IP addresses (`sendDefaultPii: true`) and masked replays.
- **Google Tag Manager and GA4.**
  - The container (outside this repo) still has GA4 tags that would send `opinion_amount`, `register_interest` and `user_id` on four older event names. They cannot receive amounts any more (the page no longer provides them), but they should be removed in GTM.
  - GA4 may hold such data from earlier versions of the site. It can be removed with GA4's data-deletion requests.
- **Small numbers.** With one or two opinions in total, the one amount is obvious to the agent (unchanged; already stated in `opinionPrivacy.js`).

## Deploying

1. Merge and deploy the app.
   - The new app's writes are accepted by the rules live today: dry-run checked with the Firebase Rules API, 34 cases.
   - Nothing breaks while the old rules are still live.
2. After the deploy is live, deploy `firestore.rules`: `firebase deploy --only firestore:rules`.
   - This enforces the split and removes the agents' raw read access.
   - A browser tab left open from before the deploy could fail one registration with "Something went wrong. Please try again". A reload fixes it.
3. **Rollback:** redeploy ruleset `82c7bc42-7237-4013-a8f0-44b588f6cc94` and revert the app.
   - Registrations made in the meantime remain valid records.
   - The older code would count each one as one more "opinion" (so a buyer who also gave a price would be counted twice) until the fix is redeployed.
