# Office Workspace: preview deployment plan

**Prepared only. Nothing in this document has been executed.** Every step below needs approval first.
Companion: `OFFICE_WORKSPACE_RELEASE.md` (checklist, smoke tests, rollback).

## The one fact that shapes this plan

A preview deployment of this repository is **not isolated from production data**:

* The browser Firebase config is hardcoded to the live project (`premarket-homes`, `src/app/firebase/clientApp.js`).
* The server uses `FIREBASE_SERVICE_ACCOUNT` / `FIREBASE_*` from Vercel env, which for Preview are normally the same live credentials.
* Crons (`vercel.json`) run only on Production, so a preview will not run invoice or newsletter jobs.

So every write made on a preview (a profile, a campaign, a charge, an email) is a real production write. The plan therefore
uses a **dedicated test office and test inboxes**, access-protected, and keeps HPH agents out of it.

## Preconditions (approvals needed)

1. Approval to push `feat/office-workspace` to GitHub. The repository is connected to GitHub; pushing a branch normally creates a Vercel
   preview automatically. (The branch is local only today.)
2. Approval to create ONE production test office and 3 test accounts using Premarket-owned inboxes (office admin, team creator,
   invited-never-logged-in agent) via the normal flows. Production currently has a single active office (HPH); a separate
   test office keeps tests out of HPH reports and billing.
3. Confirmation of billing state, read-only: `settings/invoicing.billingActivatedAt` (unset means no charge is created).
   If set, decide whether to accept and reverse one test charge, or exclude the test agent (`excludeAgentIds`, a billing
   setting change that needs its own approval).
4. Counsel review is not required to run the preview, but is required before HPH uses the terms flow (release doc, section 6).

## Steps

1. **Integrate first (if remediation has committed).** Re-run the merge simulation (below). Preview the *combined* result if both
   are going out together; otherwise preview `feat/office-workspace` alone (it merges cleanly on its own).
2. **Check Vercel Preview environment variables** (dashboard, read-only): `FIREBASE_SERVICE_ACCOUNT` (or the three `FIREBASE_*`),
   `BUNNY_STORAGE_ACCESS_KEY`, `RESEND_API_KEY`, `NEXT_PUBLIC_BASE_URL`, `CRON_SECRET`. Missing keys explain "Storage not configured"
   or silent email failures. Do **not** add Xero or newsletter variables to Preview (`NEWSLETTER_SEND_ENABLED`, Xero stay off).
3. **Protect the preview.** Vercel deployment protection (SSO/password) ON for the preview URL, so only the team can open it.
4. **Push the branch** (once approved): `git push -u origin feat/office-workspace`. Do not open a PR to `main` yet. Wait for the preview URL.
5. **Prepare the test office** with the approved test accounts. The invited-never-logged-in agent is created through
   Office > Add Agent (this sends one real invitation email to the test inbox, which is itself a useful check).
6. **Run the smoke tests** in release doc section 2, in order, recording pass/fail and screenshots. Test 1 (legacy duplicate email)
   first, because it can change what you ship.
7. **Google Places caveat:** the Maps key is referrer-restricted. If the preview domain is not on its allowlist, Places will not
   load on the preview. Do not loosen the key; run that single test after merge on the production domain with the test office.
8. **Decision point:** go / no-go from the results (below). Then tear down.

## Teardown

* Archive every test campaign (Office > Campaigns > Archive); reverse any test charge through the existing billing flow.
* Remove the test accounts or leave them disabled; delete the preview deployment, or keep it behind protection.
* Record `emailLog` and `officeCampaignAudit` entries as the audit of what the test did (they are additive and harmless).

## Go / no-go criteria for the preview

Go only if: exactly one email per event; no duplicate legacy email (or it is retired/switched off); photos upload and display;
billing result matches the checklist; every forbidden request returns 403/404 and creates nothing; HPH data untouched
(`officeAdminUids` identical, no HPH `officeAgents` created, no HPH campaign created).

## Merge simulation (no side effects; use any time)

```
git worktree add --detach /tmp/merge-check feat/office-workspace
cd /tmp/merge-check && git merge --no-commit --no-ff feature/platform-remediation
npm ci && npx vitest run tests/unit && npm run lint && npm run build
git merge --abort; cd - && git worktree remove --force /tmp/merge-check
```

Run it against remediation only once its working tree is committed; never in its own checkout. Last result (their committed tip
`a5d16d5`): 0 conflicts, 2,036 tests pass, lint 0 errors, build passes. Their 20 uncommitted palette edits touch single lines in
`office/page.js` and `settings/page.js` far from mine; no textual conflict is expected.

## Merge order recommendation

1. `feat/office-workspace` into `main` (additive, independently valuable, clean against `main`).
2. Then `main` into `feature/platform-remediation`, re-run its tests. The palette tests that previously objected to two of my
   colours have already been fixed on my branch.
3. Phase D (privacy) lands separately and later; keep Registrations access as decided in release doc section 5.
