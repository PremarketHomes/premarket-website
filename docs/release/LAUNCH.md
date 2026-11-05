# Office Workspace: launch (read this one)

Branch `feat/office-workspace`. Checks: 1,951 unit tests, 504 rules tests, build, 29/29 staging scenarios (with the campaign switches on), clean merge with
`feature/platform-remediation` (tests, lint, build). Production was verified read-only and has not been changed.

## Launch scope (three switches, all OFF in production because none is set)
| On at launch | Off at launch (one environment variable each, set in Vercel Production, then redeploy) |
|---|---|
| Agent directory (all 94 HPH agents, missing-photo filter), profile and **photo** editing, **team** management (create, rename, add, move, remove, team admin), audit trail | `MANAGED_CAMPAIGNS_ENABLED=1`: creating or managing campaigns for another agent, campaign-link emails, the Campaigns list |
| | `OFFICE_REGISTRATIONS_ENABLED=1`: office-wide Registrations overview |
| | `TEAM_REGISTRATIONS_ENABLED=1`: team-creator access to registrations |

Everything the old Office page does today (add agent, CSV import, invitations, branding) is unchanged. Only the exact value `1` switches a feature on. Agent-led campaigns are unaffected.

## Hannah's own admin account
Hannah already has an active HPH login (agent role, not admin, not a super-admin), so no new account, password or Auth user is needed. The grant promotes that account:
`node scripts/grant-office-admin.js --office-name "Harcourts Property Hub" --email <hannah's address> --execute`
It changes exactly two fields (adds her id to the office's administrator list; sets her `isOfficeAdmin`) plus one audit record. `accounts@premarket.homes` is untouched and stays an
administrator. It refuses a Premarket address, a super-admin, an unactivated account, or any ambiguous match. Revert with `--revoke` (never removes the last administrator).
Dry run on production was done (read-only): plan OK, nothing written. **Granting gives her the existing office-admin powers at once, including Add Agent, CSV import and invitation
emails to real HPH agents**, so do it when she is ready, after the deploy.

## Still open before managed campaigns are switched on (not needed for this launch)
1. Counsel's answer on `docs/release/LEGAL_REVIEW_TERMS.md` (with Hannah on her own login, the acceptor is an HPH person, which removes the main concern).
2. The real photo and email test: `scripts/real-services-smoke.js` (needs a Resend key, a Bunny zone and key, and a mailbox from you).
Registrations stay off until the buyer opinion/registration separation (Phase D, remediation branch, pending your approval) ships. The platform must not be described as guaranteeing anonymity until then.

## One caution for the photo feature
Photo upload uses the same storage as the existing uploader (a new folder, `office-agents/<officeId>/`) but has not been run against the real storage yet. The first real upload should be a supervised
one-agent test (upload, then open the CDN link). It mirrors the new photo into that agent's login record, and the previous value is not kept.

## Deploy and rollback
Merge to `main`; Vercel deploys automatically. No Cloud Function, rules, index, data or environment change. Rollback: Vercel Instant Rollback (seconds); new data is additive and ignored by the old code.
After deploy, read-only checks as `accounts@premarket.homes`: Office, Agents, Teams appear (not Campaigns, not Registrations); directory shows 94 agents, 86 needing photos;
`/api/internal/environment` shows `deploymentEnv: "production"`, `managedCampaignsEnabled: false`.
