# Office Workspace: release checklist

Branch: `feat/office-workspace`. Status: code complete and tested locally. **Nothing here has been merged, deployed or run against
production writes.** Each step needs explicit approval. Companion: `PREVIEW_DEPLOYMENT_PLAN.md`.

## 0. Gates (all must be true before HPH uses it)

| Gate | State |
|---|---|
| Product decisions: team-creator buyer details only for campaigns they currently manage, and **switched off** until Phase D; `termsAcceptedBy` stays the actual administrator | Decided; team access is OFF by default (`TEAM_REGISTRATIONS_ENABLED`), office-admin access unchanged |
| Server-only Firestore rules (`officeAgents`, `officeTeamAudit`, `officeCampaignAudit`) | Approved in principle. **Not deployed.** Behaviour is already default-deny; test them on staging first |
| Terms wording reviewed by counsel (section 6) | **Open** |
| Phase D (opinion/registration separation) | **Open privacy blocker** for any expanded identifiable-registration release (section 5) |
| Legacy `onVendorPropertyCreated` duplicate-email risk | **Confirmed live; mitigated in code** (managed campaigns no longer set `vendorUploaded`); confirm on staging |
| Real-service smoke tests (Bunny, Resend, Places) | **Not done**, to run on staging (not on the live-backed preview) |

## Read-only facts verified against production (2026-11-05)

* **Billing is ACTIVE:** `settings/invoicing.billingActivatedAt` = 2026-10-21; automatic invoicing off (`cronEnabled: false`); one excluded agent id.
  Any campaign created in production now creates a real pending charge (on `office:{officeId}`). No production test campaigns.
* **Cloud Functions deployed:** `onVendorPropertyCreated`, `onPropertyCreatedMatch`, `onSeriousOfferCreated` are all live (document-create
  triggers). `onVendorPropertyCreated` last sent on 2026-11-03: it emails a property's owner whenever a new property has `vendorUploaded: true`.
  `onSeriousOfferCreated` is the older second registration email (existing behaviour, not caused by this release).
* **Staging:** no staging project exists. Only `premarket-homes` and an unused default project.
* **Preview backend:** the browser is hardcoded to `premarket-homes`; the server uses Vercel env credentials (not readable from here: no Vercel
  access). The code guards in `STAGING_ENVIRONMENT.md` make a live-backed preview safe regardless; `GET /api/internal/environment` shows the truth.

## 1. Verified locally (not a substitute for section 2)

Unit tests, 504 Firestore-rules tests on the local emulator, production build, and the combined result with
`feature/platform-remediation` (clean merge, tests, lint and build) all pass at the time of writing. The full wizard was
exercised in a browser against local emulators with Google Maps stubbed and outgoing mail captured to a file.
Read-only reconciliation was run against HPH production (section 3).

## 2. Smoke tests that need real services (run on the preview, section "Preview" of the companion plan)

Use a dedicated test office and Premarket-controlled test inboxes, never HPH agents. Record each result.

1. **Legacy duplicate-email check (do this first).** The legacy Cloud Function `onVendorPropertyCreated` is live and emails a property's
   owner when `vendorUploaded` is true. Managed campaigns now save `vendorUploaded: false` (`MANAGED_VENDOR_UPLOADED` in
   `managedCampaignService.js`), so it should NOT fire. Create one managed campaign for a test agent: expect exactly ONE email, "Your Premarket
   campaign link". A second old-design "Property Added to Your Dashboard" email means something else still reads the flag; stop and report.
   Also confirm `onPropertyCreatedMatch` sends nothing (managed campaigns start with the link hidden, so it skips). The mobile app's use of
   `vendorUploaded` is unverified.
2. **Real Bunny uploads.** (a) Office > Agents > Edit Profile > upload a JPEG, save: photo appears in the directory and on
   the agent's public campaign page. (b) Create a campaign with 2 real photos: both appear on the buyer page.
   Check: file type/size rejections (PNG ok, SVG/GIF/6 MB refused), no photo created if save fails.
3. **Resend delivery.** The campaign-link email arrives, renders (address, link, steps), the link opens the buyer page,
   "Email link to agent" resends once, a second click inside a minute is refused. Register interest on the test
   campaign: the registration email reaches the assigned agent, shows the buyer's contact details and **no opinion
   amount**. Repeat the registration submit: no second email. Resend dashboard shows idempotency keys, no bounces.
4. **Google Places.** `https://<preview>/dashboard/add`: address suggestions load and select (the key is referrer
   restricted; the preview domain must be allowed or Places will fail. If so, run this one test after merge on the
   production domain with the test office). Wizard completes for (a) office admin for an invited agent, (b) team creator
   for a teammate, (c) a plain agent (no selector shown).
5. **HPH account permissions (read-only).** Sign in as `accounts@premarket.homes`: Office, Agents, Teams, Campaigns,
   Registrations are visible; Leadership accounts (Dave, Trevor) see Leadership Hub only and get 403 from every new
   route; an ordinary HPH agent gets 403/"not available" on Office pages. Confirm `officeAdminInfo.officeAdminUids` is
   unchanged before and after (the release changes no role).
6. **Office profiles.** Directory shows 94 HPH agents; "Missing photo" lists 86 (placeholder avatars are not photos).
   Edit one test agent: name/phone/photo appear on that agent's campaign page; login email unchanged; Firebase Auth user
   unchanged (`getUser` before/after: same email, `emailVerified`, `disabled`, `lastSignInTime`).
7. **Campaign creation + attribution.** Campaign owner = assigned agent; `createdByUid` = the admin; `termsAcceptedBy` =
   the admin; appears on the agent's dashboard when they log in; hidden/visible/archive actions work; a team creator
   cannot choose an agent outside their team (forge the request: expect 404, nothing created).
8. **Billing attribution (read-only checks, no config change).** First read `settings/invoicing.billingActivatedAt`.
   If unset, a campaign creates NO charge (existing rule; verify there is none). If set, expect exactly ONE
   `propertyCharges/{propertyId}` on `office:{officeId}` at the configured price, identical in shape to an agent-created
   one; retry the same request: still one. Do not run invoice runs. If real charges would be created, use a test
   office, or get approval for the charge and its reversal.

## 3. HPH reconciliation (run, read-only, 2026-11-05)

`node scripts/reconcile-office-agents.js --office-name "Harcourts Property Hub"` (structurally read-only; masked output).
Result: 94 people (60 invited and never logged in, 34 active); 8 have a real photo (86 need one); 0 exact matches
(no `officeAgents` profiles exist yet, expected); 0 ambiguous; 0 duplicates; 0 staged import rows; 1 listing-agent
profile left untouched. No migration is needed to launch: profiles are created lazily on the first edit.

## 4. Go-live sequence

1. Approvals (companion plan) and counsel review of section 6.
2. Merge `feat/office-workspace` to `main`, Vercel deploys. Nothing changes for agents; new navigation appears only for office
   admins (and "create for a teammate" for team creators).
3. Smoke test section 2 on production with the test office (items that could not run on preview).
4. Hannah's first session with a Premarket person watching: upload photos for 3 agents, then stop and review.
5. Optional, after review: deploy the three server-only rules (`firebase deploy --only firestore:rules` only after
   `npm run test:rules` passes against the exact `firestore.rules`).

Watch for the first week: Vercel logs for `/api/offices/*`, `/api/properties/managed*`, `/api/registrations/managed`;
`emailLog` statuses (`failed`, `needs-review`); Resend bounces; `officeCampaignAudit`; support messages from agents about
duplicate emails.

## 5. Phase D privacy blocker (status as of this check)

Opinion/registration separation (audit F01/F02) is **not implemented** on `feature/platform-remediation`: its plan lists
both as "Pending approval", Phase D is "design, tests and preparatory code only", and it has changed no rules, offers,
reports or notification code. A registration and an anonymous price opinion are still stored on the same `offers`
document. Consequences for this release:

* The office and team registration lists copy out only an allowlist of registration fields and show the date only
  (no time), so they cannot be matched to opinion timestamps. This is data minimisation, **not anonymity**.
* Office admins already had full report access (existing behaviour); their office-wide Registrations list uses the same data authority.
* **Team-creator access to identifiable registrations is OFF by default** (`TEAM_REGISTRATIONS_ENABLED` must be exactly `1`; the My Team link is
  hidden and the route returns 403 otherwise). Existing agent access (own campaigns) and office-admin access are not expanded.
* Do not describe the platform as guaranteeing anonymity until Phase D ships. Recommendation: launch the Office Workspace
  for agent directory, profiles, teams and campaigns now. Team-creator Registrations stays off until Phase D is approved and shipped.

## 6. Legal wording flagged for review (nothing rewritten)

* Terms checkbox (unchanged): "I have read and agree to the terms and conditions".
* New note shown only when creating for another agent: "You are accepting these terms yourself, as the person creating this
  campaign for {agent}. The agent has not personally accepted them. Your acceptance is recorded against your name."
* The terms text itself is the agent terms (`settings/addPropertyTermsAgent`, plus the office retail wording). Production
  text was not read. The remediation plan flags that the Terms and Privacy pages describe a different product (F06).
* Campaign-link email: "Your office has set up a Premarket campaign for you." and reason line "You're receiving this because
  your office set up a Premarket campaign for you."
* Questions for counsel: (a) may an office administrator accept the agent terms for an agent's campaign; (b) must the
  agent also accept on first login; (c) do the terms' charges apply to the office as the billed entity (billing is the
  office entity today).
* Stored as `termsAcceptedAt` + `termsAcceptedBy` (the administrator). Nothing else reads these fields.

## 7. Rollback

* **Code:** Vercel "Instant Rollback" to the previous deployment (seconds, no data change needed).
* **Data written by the new code is additive and ignored by old code:** `officeAgents` and its `audit` subcollection,
  `officeTeamAudit`, `officeCampaignAudit`, `emailLog` entries, `teams.name`, managed `properties` (flagged `managedCreation`).
* **One change to an existing record:** a photo upload mirrors the new photo into that agent's `users.avatar`. To revert,
  restore the previous value (the old value is not stored; capture it before the first real edit on the day, from the
  directory API, if rollback of photos matters). Public pages would otherwise keep the new photo.
* **Managed campaigns:** archive via Office > Campaigns (stops the buyer link); a created charge is reversed through the
  existing billing reversal process, not by deleting documents.
* **Rules:** if deployed, redeploy the previous `firestore.rules` (default-deny keeps the new collections closed regardless).
* **Emails** cannot be recalled: this is why section 2 uses test inboxes first.

## 8. Known gaps (not blockers)

Managed campaigns accept photos only (no video, no server-side compression at creation; the existing compress cron runs
every 15 minutes). A staged agent with no account yet cannot own a campaign until their invitation creates one. Name
edits show on public pages but not in an agent's own dashboard greeting. Lint headroom is 2 warnings on the combined tree.
