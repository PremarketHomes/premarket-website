# Premarket email audit

Who controls each email, what triggers it, and its status after the redesign.
"Website" emails are sent by this repo (Vercel). "Firebase" emails are sent by
Cloud Functions, which are deployed separately from `premarket-functions`
(local repo, recovered from deployed version 7).

Design source of truth: `src/app/api/services/emailTemplates.js`
(solid colours only, tables, Outlook VML buttons, dark-mode CSS, plain-text part).
Preview everything locally: `npm run email:previews` then open `email-previews/index.html`.

## Website-controlled (redesigned on branch `feat/email-redesign`)

| Email | Trigger | Code |
|---|---|---|
| Office invitation (new agent account) | Office admin adds / imports / sends | `resendService.sendOfficeInviteEmail` |
| Office invitation (existing user) | Office admin adds an existing user | `resendService.sendOfficeJoinInviteEmail` |
| Password reset (user-requested) | Reset request | `sendPasswordResetEmailTemplate` |
| Password reset (admin-sent) | Admin action | `api/admin/users/[id]/reset-password` |
| Admin "send email" (reset / welcome / live / follow-up) | Admin action | `api/admin/users/[id]/send-email` |
| Property is live | Property goes live | `sendPropertyLiveEmail` |
| New prospect added | Vendor adds a property | `sendPropertyAgentEmail` |
| New buyer registration | Buyer registers interest | `sendNewBuyerInterestEmail` |
| Vendor invitation | Agent invites a vendor | `sendInviteLink` |
| Property link to share | Agent requests link | `sendLink` |
| Listing follow-up (14/30 days) | Daily cron | `sendPropertyFollowUpEmail` |
| Weekly buyer newsletter | Weekly cron | `newsletterService` |
| Daily market report | Daily cron | `cron/market-report` |
| Seller insight report (PDF) | Agent sends report | `reportService` |
| Invoice preview (test) | Admin | `invoicePreviewService` |
| Invoice run ready (staff) | Daily cron | `cron/invoice-dry-run` |
| Contact form (staff) | Website form | `api/contact` |

Not ours: Xero sends the actual invoices; Firebase sends its own password-setup
page (the activation email only links to it via the 14-day Premarket link).

## Firebase-controlled (legacy, deployed v7 — NOT changed, not deployed)

| Email | Trigger | Problems found |
|---|---|---|
| Agent welcome | `onProAgentSignup` (fires for every pro agent, incl. office-created) | Old gradient design, App Store/Google Play. **Replaced** by `welcome/` codebase (redesigned, skips office agents) — awaiting cutover |
| Registered interest (to agent) | `onSeriousOfferCreated` | App download buttons; **may duplicate** the website's buyer-registration email |
| New property match (to buyer) | `onPropertyCreatedMatch` | Old design |
| Buyer welcome | `onBuyerSignup` | Old design |
| Vendor property added | `onVendorPropertyCreated` | "Open the Premarket App" + store buttons |
| Weekly buyer newsletter | `sendWeeklyBuyerNewsletter` | Old design; **duplicates** the website newsletter |
| Property live / new prospect / vendor invite / share link / report | `api` HTTP function | Duplicate old copies of website emails; new-prospect says "inside the Premarket app" |
| In-app notification email | `sendNotificationEmail` | Unstyled; "Open the Premarket app" |
| Campaign emails (`emails/campaigns/*`, `emails/properties/*.html`) | Campaign / video pipeline | App-based instructions |

All Firebase emails also send from a hardcoded Resend key in the deployed source
(a security item, separate from design).

## Fixes made on the website
- Removed every gradient (white-on-white buttons and heroes).
- Removed all app references from website emails.
- Outlook-safe buttons (VML), fluid 600px layout, dark-mode CSS, plain-text part on every email.
- Office invitation emails rebuilt: clear heading, activate button, 3 steps, 14-day notice, copy-link fallback; office name now escaped.
- Stand-alone admin/staff/report emails moved onto the shared design.
- Links, tokens, subjects, senders and triggers unchanged.
