# BSO Workspace: release checklist

Branch: `feat/bso-workspace` (from `origin/main` e67550b). **Not merged, not deployed. No production data or permission has
been changed.** Every production step below needs explicit approval.

## What changes

| Area | Change |
|---|---|
| Roles | New **BSO** role: `officeAdminInfo/{officeId}.bsoUids` (server-only, same doc as `officeAdminUids`). Office admins assign/remove it in Office > Agents (audited in `officeTeamAudit`). Nothing is written to user documents. |
| Campaign identity | Selling agent = owner (`userId`, unchanged); managing user = new `managedByUid`; creator = `createdByUid`/`createdByRole` (kept for audit). |
| Authority | One live per-campaign check (`resolveCampaignRole`): owner, office admin of the owner's current office, or the campaign's `managedByUid` while they hold the BSO role there. No team-based authority. |
| BSO dashboard | `/dashboard/bso` "My Campaigns": campaigns the BSO manages plus any they own; filter by selling agent; copy/open buyer link; edit; feedback & report; go live/hide; email link to agent; archive. |
| Office admin | Office > Campaigns: selling agent, "Managed by", creator; filters by BSO and selling agent; "Needs a manager"; **Change manager**; Edit (office-managed campaigns only); Feedback & report. Wizard: "Managed by" choice. |
| Editing | Managing BSO / office admin edit details and add photos through allowlisted server routes (`/api/properties/{id}/managed/details`, `/media`) via the background upload manager. Ownership, management, billing, terms and visibility cannot be changed there. Video stays with the agent. An agent's own campaign stays read-only to the office unless the office admin assigns it a manager. |
| Reports | The managing BSO gets the office-admin report level (read-only, registration details) for campaigns they manage only. No BSO or team registrations list. |
| Team Admin | Retired: no team-creator campaign creation/management/resend, no team registrations scope, no badges or role selection. Kept for now: a team creator's **Remove** teammate control on My Team. Office agent removal no longer blocks on choosing a team admin (the creator record passes on, as when a creator leaves). Teams and the read-only redacted teammate view are unchanged. |
| Rules / data | `firestore.rules` unchanged. New property field `managedByUid`; new office field `bsoUids`. No migration needed to deploy. |
| Flags | Everything BSO is behind the existing `MANAGED_CAMPAIGNS_ENABLED` (off in production). Registration flags untouched. |

## Who holds Team Admin today (production, read-only, 2026-11-06)

4 teams in HPH, each with a creator: Isabella Cross-Winston, Brooke Campbell-Rawson, Phil Chillemi, Scott Rigby. None is an office
admin. Because `MANAGED_CAMPAIGNS_ENABLED` and the registration flags are off, their only live extra power today is removing a
teammate from their own team (kept). Enabling the flag on the **old** code would have switched on their campaign powers; on this
branch it does not. None of them becomes a BSO automatically.

## Verified (this branch)

* Unit tests: 2031 passed (includes `tests/unit/bso-workspace.test.js`, 27 BSO scenarios, and the migration planner tests).
* Firestore rules tests: 504 passed (rules unchanged). Emulator e2e: 8 passed. Production build: passes.
* Staging (`premarket-ows-staging-dbf1`, fake data only, isolation confirmed before seeding):
  `scripts/staging-smoke.js` 29/29 (updated for the retired Team Admin) and `scripts/bso-staging-smoke.js` 15/15.
  Substitutes as before: Places stubbed, Bunny fake upload target, Resend captured to a file (never sent).
* Local staging harness note: `~/.premarket-staging/staging.env` lacks `RESEND_API_KEY` and `BUNNY_STORAGE_ACCESS_KEY`; the
  run used placeholder values (both services are intercepted by the local preload) and `VERCEL_ENV=preview` (email allowlist on).

## Before production activation (each needs approval)

1. Review and merge `feat/bso-workspace`; Vercel deploys. Inert while `MANAGED_CAMPAIGNS_ENABLED` is off (no BSO navigation, routes 403).
2. Open items from `OFFICE_WORKSPACE_RELEASE.md`: counsel review of the "accepting terms on the agent's behalf" note; real-service
   checks (Bunny photo rendering from the CDN, Resend delivery, Places on the production domain).
3. Set `MANAGED_CAMPAIGNS_ENABLED=1`. Effects: office admins get Campaigns and create-for-agent; BSO features become usable once a
   BSO is assigned; each created campaign records a real pending charge (billing active) and sends the existing campaign-link
   email once to the selling agent. Registration flags stay off.
4. Hannah assigns BSO roles (Office > Agents > ⋮ > Make BSO), e.g. Peta. First real campaign watched by a Premarket person.
5. After the BSO workflow is verified: retire the team creator's Remove control (office admins already manage team membership).

## 73 Riverwalk Ave migration plan (`MuAUxFW4Ufd8XiIPD62N`)

**Works throughout without any change:** before migration it already appears in Peta's My Campaigns under Chantal (owner = Peta,
selling agent resolved from the roster name, same rule as the buyer page), and the buyer page keeps showing Chantal.

Read-only dry run against production (2026-11-06) with
`node scripts/migrate-legacy-bso-campaign.js --property MuAUxFW4Ufd8XiIPD62N --selling-agent <Chantal uid> --manager <Peta uid>`:

| Check | Result |
|---|---|
| Chantal's account | HPH agent, active, Auth account exists, not disabled, email verified, has signed in; unique name match to the roster entry |
| Current record | owner Peta; roster agent "Chantal Damiani"; no `managedByUid`/`createdByUid`; link hidden; `draftProperties` copy exists |
| Buyer page after the move | same name, real photo, phone, office, company name and branding |
| Data kept | 1 offer (price opinion, 0 registrations), 0 likes, photos, link (same property id) |
| Registration emails | today to Peta (owner); after the move to Chantal (owner). Past ones are not re-sent |
| Billing | charge `propertyCharges/{id}` on `office:HPH`, pending, `agentUserId` Peta. **Left untouched**: same office entity; office invoices consolidate by office |
| Cloud Functions | only `onPropertyWriteInvalidateScores` fires on update (cache only, no email); create-only triggers do not run |
| **Blocking** | Peta does not hold the BSO role yet. The script refuses until she does, because the move would otherwise remove her access |

Write (one transaction; `properties` + `draftProperties`; audited as `campaign.migrateToBso`):
`userId` Peta → Chantal, `agentId`/`agentName` → null, `managedByUid` → Peta, `createdByUid` → Peta, `createdByRole` → `bso`.
A rollback file with the previous values is saved first (`~/.premarket-migrations/`), and
`--rollback <file> --execute --confirm <id>` restores them exactly (refuses if the record changed since).

Order: after activation and after Hannah makes Peta a BSO → dry run (must be all PASS) → `--execute --confirm MuAUxFW4Ufd8XiIPD62N`
→ check the buyer page and Peta's My Campaigns → optionally Peta presses "Email link to agent" (Chantal gets the link email;
its wording says "again" because it is a resend).
