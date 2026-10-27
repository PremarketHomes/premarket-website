# Operation 1: email and legacy-functions cleanup, rollout runbook

Status: code is local and tested; NOTHING below has been run in production.
Every step needs explicit approval before it is executed.

## What changed in the website (local, uncommitted)

| File | Change |
|---|---|
| `src/app/api/services/notificationService.js` (new) | `sendPropertyReadyOnce`: durable once-per-event send. Claim doc in server-only `emailLog` (transactional), recipient eligibility, Resend idempotency key. |
| `src/app/api/services/resendService.js` | `sendPropertyReadyEmail` (new premium template, shared components). `sendEmail` accepts an optional `idempotencyKey` (unchanged for every other caller). |
| `src/app/api/admin/reassign-properties/route.js` | Per-property transaction; a change of owner bumps `ownership.seq` (the event id). Notification is opt-in (`notify: true`, max 25 properties per request). No longer fails the whole request on one missing property. Max 200 per request. |
| `src/app/dashboard/admin/components/tabs/PropertiesTab.js` | "Email the agent" checkbox in the reassign modal (default OFF). |
| `src/app/api/services/newsletterService.js` | Ported "Hottest This Week"; restored the missing `parsePrice` (see below). |
| `tests/unit/newsletter-hottest.test.js` (new) | 11 tests for the newsletter. |
| `tests/unit/notification-service.test.js`, `reassign-properties-route.test.js`, `property-ready-email.test.js` (new), `tests/previews/email-previews.test.js` | 35 new tests; property-ready added to the preview catalogue. |

No new scheduled job, no new infrastructure, no rules change (`emailLog` is covered by the existing default deny).

## Dedupe model

Event key = `property_ready__{propertyId}__{recipientUid}__{ownership.seq}`.
- Same request repeated: owner already equals target, so no change, no new seq, no email.
- Concurrent / retried sends of one event: transactional claim, then Resend Idempotency-Key (same key).
- Later reassignment (to anyone, including back to a previous owner): new seq, new email.
- Stale event (property moved on or deleted before send): skipped, never sent to the old owner.
- Recipient must be active: user doc + email, `accountStatus` unset or `active`, not `unsubscribed`/`disabled`/`deactivated`, Firebase Auth account exists and is not disabled. If Auth cannot be checked, nothing is sent and the event stays retryable.
- Agents uploading their own property: no email (nothing in the add flow calls this).
- Vendor submissions: NOT wired. The web vendor forms (`Form.js`, `FormBranded.js`) are not imported anywhere and cannot create a property for another user under the current rules. Wire `sendPropertyReadyOnce` into the real vendor path once it is identified (Flutter app or a future server route). Needs a decision.

## Production rollout sequence (each step separately approved)

0. Evidence, read-only. Function logs (30 days, per function), Vercel logs for the last two Saturday newsletter crons, Resend key list with last-used, GCP IAM members and service-account key list, Vercel `FIREBASE_SERVICE_ACCOUNT` key id (compare id only). Decide on the "hottest properties" section (below).
1. Review and merge the website change; Vercel deploys it. Impact: reassign gets a checkbox; nothing else changes. Rollback: Vercel instant rollback to the previous deployment.
2. Live verification, one controlled event: reassign one test property to an account you control with the box ticked (it is off by default). Expect exactly one email, one `emailLog` doc with status `sent`. Repeat the same request: no email. Reassign elsewhere and back: two more emails total. Untick the box: none.
3. Retire `sendWeeklyBuyerNewsletter` after confirming the website cron sent last Saturday. Command: `firebase functions:delete sendWeeklyBuyerNewsletter --region us-central1 --project premarket-homes` (also removes its scheduler job). Impact: one newsletter per week instead of two. Rollback: redeploy that single function from `~/premarket-function-backups/function-source-v8-deployed.zip` (complete deployed package).
4. Retire `onSeriousOfferCreated` the same way. Impact: agents get only the website registration email; signed-in-buyer registrations stop producing a second, old-design email. Rollback as above. Before: confirm the website `notify-interest` route is sending (Vercel logs, `interestNotifiedAt` set on recent offers).
5. Retire `onVendorPropertyCreated`. Impact: agents stop emailing themselves when they add their own property. Rollback as above.
6. Keep: `onBuyerSignup` (old design flagged for later), `onPropertyCreatedMatch` (until logs show whether it fires), `onProAgentSignup`, `api`, video task queues, and the three score-invalidation triggers.
7. Credentials (see below), only after steps 3-5 have been stable for a few days.

Never run a bare `firebase deploy`. The `premarket-functions` repo is NOT a faithful copy of what is deployed (its `index.js` does not export `onProAgentSignup`, and `serviceAccountKey.json` is absent), so a codebase deploy from it would drop or break functions. Use `functions:delete` for retirements and the v8 zip for rollback.

## Verification after each production step

- Function list (`firebase functions:list`) shows only the intended functions.
- Resend dashboard: no sends from the retired path; `emailLog` shows `sent` / `skipped` with reasons.
- Vercel logs for the reassign route show no errors.

## "Hottest properties" in the weekly newsletter

Only the legacy function renders it (top properties by offers in the last 7 days). Recommendation: port it into `newsletterService.js` (small, about an hour, with tests) BEFORE step 3, so the weekly email loses nothing. If it is not valued, drop it. Not implemented; your call.

## Credential rotation plan (not started)

Findings: the deployed package embeds `serviceAccountKey.json` (service account `firebase-adminsdk-fbsvc@premarket-homes`, key id starts `d66e65e9`, dated 2026-01-03) and a hardcoded Resend key fallback. After steps 3-5 the functions still using email are `onBuyerSignup`, `onPropertyCreatedMatch`, `onProAgentSignup`.

Rotate in this order, one change at a time:
1. Inventory (step 0). If the website's `FIREBASE_SERVICE_ACCOUNT` is the same key id, give Vercel its own NEW key first: create key, set in Vercel, redeploy, verify admin routes (login, an admin page, a cron call).
2. Repackage the functions from the v8 zip in a fresh directory: initialise Admin SDK with default credentials (the function runtime identity `premarket-homes@appspot.gserviceaccount.com`), remove `serviceAccountKey.json`, remove the hardcoded Resend fallback, read `RESEND_API_KEY` from function env. Deploy the affected functions one by one with a NEW Resend key created for functions only. Verify each (signup trigger on a test account you control).
3. Watch 24-48 hours. Disable (not delete) the old service-account key; watch again. Delete it after about 7 days.
4. Delete the legacy Resend key last (Resend cannot disable, so rollback means issuing a new key; the new keys are already in place by then).
5. Remove the local backup zips from this Mac or move them to a private vault once rollback is no longer needed (they contain the credentials).

Rollback at each stage: re-enable the disabled service-account key (before deletion); re-deploy the previous function version from the v8 zip.


---

# Revision 2 (second local review)

## Important discovery: the website newsletter was partly broken

`parsePrice` was deleted from `newsletterService.js` on 2026-03-29 (commit 0c45e14) while `matchPropertiesToBuyer` still calls it. Any buyer whose preferences pass the location/bedroom filters for at least one new property throws a ReferenceError, is counted as an error, and gets nothing from the website. Buyers matching nothing fall back to "all newest" and do send. So the legacy Firebase newsletter has likely been the only reliable weekly email, and the "duplicate" was partial. Retiring `sendWeeklyBuyerNewsletter` BEFORE this fix is live would have silently cut most buyers off. Fixed locally (function restored, regression test added). Hard rule: retire the function only after the fixed website has sent one real Saturday newsletter that you have checked (sent count vs buyers, no errors in the cron response/Vercel logs).

## Hottest This Week

Ported with the legacy logic: offers created in the last 7 days, counted per property, top 5, only active and visible listings. Differences: a property already shown under Latest Listings is not repeated under Hottest (legacy showed it twice); subject keeps the old wording when there is no hot section. Counts include every offer (price opinions and registrations), so the open `offers` write (audit P1-1) can inflate this ranking until that is fixed. Hottest-only emails still send when nothing new was listed.

## Overlap with `onVendorPropertyCreated` (none)

- New path = server-side reassignment of an EXISTING property (an update). It never creates a property document.
- `onVendorPropertyCreated` fires only on property CREATE with `vendorUploaded: true`.
- They are different events; one admin action cannot trigger both. The only web create path that sets the flag is the agent's own "add property", which does not call the new path.
- Deploying the website changes nothing in Firebase: no function, schedule or trigger is touched.
- Precondition recorded for later: if the vendor-submission path is wired to `sendPropertyReadyOnce`, retire `onVendorPropertyCreated` first (or confirm vendor creates do not set `vendorUploaded` at creation), otherwise those would double.

## Bulk cleanup safety

- Checkbox default OFF, reset to OFF each time the modal opens. API default is no email unless `notify: true`.
- Server refuses `notify: true` for more than 25 properties (nothing is moved when refused).
- The only caller of the notification code is this route. User deletion, office/CSV import, CRM sync and the office-admin property tools do not call it.
- Repeating a request cannot create a first-time email: properties already owned by the target only RETRY an existing failed event.

## emailLog state machine (as reviewed)

`sending` (claim, 2-minute lease) then `sent` | `skipped` (terminal) | `failed` (retryable) | `needs-review` (parked).
- Concurrent requests: transactional claim; the second sees a fresh lease and does nothing.
- Failed send: released immediately; retried only by repeating the admin request (never by a timer, so no uncontrolled retries); max 5 attempts, then `needs-review`.
- Definite Resend rejection (`uncertain: false`): nothing was sent, retry at any time.
- Timeout/network error/crash (`uncertain: true` or stale `sending`): the email may have been delivered. Retried only with the same Idempotency-Key and only inside 23h of the first attempt (Resend remembers the key for 24h, so Resend returns the original send instead of a second one). Beyond that the event is parked as `needs-review` for a human, never re-sent automatically.
- Crash after Resend accepted but before `sent` was written: covered by the same rule.
- Residual risk: none that can silently duplicate. A parked event needs a human decision; nothing can block a NEW assignment, which has a new seq.

## Deployed functions, verified live (`firebase functions:list`, read-only, 2026-10-28)

All 13 are `gcfv1`, ACTIVE, nodejs22, us-central1. Snapshot saved to `~/premarket-function-backups/functions-list-2026-10-28.json` (mode 600).
`api`, `handleSeedreamWebhookTask`, `handleVeo3WebhookTask`, `onBuyerSignup` (users create), `onLikeWriteInvalidateScores` (likes create), `onOfferWriteInvalidateScores` (offers create), `onProAgentSignup` (users create), `onPropertyCreatedMatch` (properties create), `onPropertyWriteInvalidateScores` (properties write), `onSeriousOfferCreated` (offers create), `onVendorPropertyCreated` (properties create), `sendWeeklyBuyerNewsletter` (scheduled).
No function has a `RESEND_API_KEY` env var (only `OPENAI_API_KEY`, `MAPBOX_ACCESS_TOKEN`), confirming the Resend key is the hardcoded fallback in source.
Retirement candidates and dependencies: `sendWeeklyBuyerNewsletter`, `onSeriousOfferCreated`, `onVendorPropertyCreated`. Nothing else in the codebase imports them or their email helpers; no other function triggers them; the website never calls them.

## Individually reversible retirement procedure (nothing run)

One function at a time, a day apart, in this order: `onVendorPropertyCreated`, `onSeriousOfferCreated`, `sendWeeklyBuyerNewsletter`.

Prepare once (rollback source):
```
mkdir -p ~/fn-rollback && cd ~/fn-rollback && unzip -q ~/premarket-function-backups/function-source-v8-deployed.zip
echo '{"functions":{"source":".","codebase":"default"}}' > firebase.json   # no ignore list: keeps the deployed package as it was
```
For each function NAME:
1. Pre-check: the replacement is verified (see checklist), and `firebase functions:list --project premarket-homes` shows NAME ACTIVE.
2. Retire: `firebase functions:delete NAME --region us-central1 --project premarket-homes` (answer the confirmation prompt by hand; never `--force`, never a bare deploy).
3. Verify: NAME gone from the list, the other 12 unchanged (compare with the saved JSON), no new errors in the remaining functions' logs.
4. Rollback of that one function: `cd ~/fn-rollback && firebase deploy --only functions:NAME --project premarket-homes` (recreates the function and, for the newsletter, its schedule; the other functions are not touched because only NAME is named). Allow a few minutes.
Note: a function deploy of the whole `premarket-functions` repo must never be used; it lacks `onProAgentSignup` and the service-account file.

## Website deploys independently of the Firebase functions (confirmed)

- The website repo's `firebase.json` has no `functions` section (only emulators, Firestore rules and indexes), so nothing in the website repo can deploy or alter a function.
- The website does not call any Cloud Function (no `cloudfunctions.net` or `run.app` references) and shares no source with `premarket-functions` (a separate local directory).
- Production website deploys through Vercel from `PremarketHomes/premarket-website` (branch `main`); merging deploys it. `firestore.rules` is unchanged, so no rules deploy is needed. Vercel rollback is an instant redeploy of the previous build.
- The website change is inert until used: no new cron, no new trigger; the only behavioural changes are the reassign route (off unless `notify: true`) and the newsletter fix/hottest section on its existing Friday 23:00 UTC schedule.

## Lint and build

- `npm run lint` cannot run: the script is `next lint`, which Next 16 removed ("Invalid project directory ... /lint"), and ESLint is not installed or configured. Pre-existing, not touched.
- `next build` (production): success, TypeScript step passes. Two pre-existing warnings from Sentry's OpenTelemetry dependencies (`import-in-the-middle` version mismatch) and a stale `baseline-browser-mapping` notice.

## GO / NO-GO checklist

Website deployment (all must be yes):
- [ ] Full unit suite green except the 11 emulator-only rules files (93 passed / 1,424 tests); you accept that rules tests cannot run here.
- [ ] Production build passes (done).
- [ ] You have reviewed the diff and the property-ready and newsletter previews.
- [ ] Newsletter timing agreed: with the legacy function still live, the next Saturday buyers get BOTH emails (website now works for them) until step 3 below. Either accept one week of duplicates or ask for the legacy newsletter to be retired the same day after a verified website send.
- [ ] Vercel previous deployment noted for instant rollback.
- [ ] Nothing else is merged in the same release.

After deploy, before any function is retired:
- [ ] Controlled reassign test (one property, an account you control, box ticked): exactly one email, one `emailLog` `sent`; repeat request sends nothing; second test untick sends nothing.
- [ ] Next Saturday website newsletter run: cron response shows `sent` close to the buyer count and `errors` 0; spot-check one received email includes Hottest This Week.

Retire `onVendorPropertyCreated`: [ ] new email verified above; [ ] 30-day logs reviewed (what actually fires it).
Retire `onSeriousOfferCreated`: [ ] a recent registration has `interestNotifiedAt` set by the website route; [ ] agents confirm they receive the website email.
Retire `sendWeeklyBuyerNewsletter`: [ ] a verified good website newsletter send (sent count vs buyers, errors 0, Hottest present); [ ] you accept the content difference (legacy design/intro lost).
Stop immediately (NO-GO / roll back) if: agent or buyer emails stop arriving, `errors` appears in the newsletter response, any non-target function shows new errors, or the function list differs from the saved snapshot beyond the one retired function.
