# Security Architecture

## Authentication Methods

### 1. Firebase ID Tokens (primary)
All authenticated API routes verify Firebase ID tokens via the `Authorization: Bearer <token>` header.

**Server-side middleware** (`src/app/api/middleware/auth.js`):
- `verifyAuth(request)` - Verifies the Firebase ID token, returns `{ authenticated, uid, email }`
- `verifyAdmin(request)` - Calls verifyAuth + checks `superAdmin` flag in Firestore
- `verifyCron(request)` - Checks `Bearer ${CRON_SECRET}` for cron job authentication

### 2. API Keys (v1 endpoints)
External API consumers use API keys validated by `validateApiKey()` in `src/app/api/v1/middleware.js`. Keys are stored in Firestore user docs (`apiAccess.apiKey`).

### 3. Cron Secrets
Vercel cron jobs authenticate with `CRON_SECRET` via Bearer token. Centralized in `verifyCron()`.

## Adding Auth to a New API Route

```javascript
import { NextResponse } from 'next/server';
import { verifyAuth } from '../middleware/auth';

export async function POST(request) {
  const auth = await verifyAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // auth.uid contains the verified user ID
  // auth.email contains the verified email
  const { someField } = await request.json();
  // ... route logic using auth.uid instead of body.uid
}
```

For admin-only routes, use `verifyAdmin` instead of `verifyAuth`.

## Client-Side Pattern

**Web (`src/app/utils/authFetch.js`):**
```javascript
import { authFetch } from '../utils/authFetch';

// Automatically attaches Firebase Auth token
const res = await authFetch('/api/some-route', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ someField: 'value' }),
});
```

**Flutter (`lib/services/auth_http.dart`):**
```dart
import 'package:premarket2/services/auth_http.dart';

final response = await AuthHttp.post(
  'https://premarket.homes/api/some-route',
  {'someField': 'value'},
);
```

## Firestore Rules Philosophy

- **Public read**: `users`, `properties`, `offers`, `likes`, `settings`, `campaigns`, `displays`
- **Owner-only**: `agents`, `draftProperties`, `image_edits`, `notifications`, `stripeTransactions`, `inAppPurchases`
- **Authenticated**: `propertyEngagement`, `priceOpinions`, `propertyStats`, `xpNotifications`
- **Server-only**: `marketScores`, `marketTrends`, `propertyScores`, `invoiceRuns`, `contacts`, `integrationCredentials`, etc.
- **SuperAdmin**: `contacts`, `displays` (write)

## Third-Party Integration Credentials (Rex, Agentbox)

Client IDs, API keys/secrets, and access tokens for connected CRM integrations live in the server-only `integrationCredentials/{uid}` collection — **never** on the `users` document. `users` is publicly readable (`allow read: if true`) for legitimate reasons (property cards need agent name/avatar without requiring login), so anything written under `users/{uid}` should be treated as public, even for a logged-in-only feature.

`rexService.js` and `agentboxService.js`'s `getCredentials()` read `integrationCredentials/{uid}` first and fall back (read-only, server-side) to the legacy `users/{uid}.integrations.*` field for any agent not yet migrated off it. `storeCredentials()`/`removeCredentials()` write only to the new location and proactively delete the legacy field, so any agent who (re)connects or disconnects is immediately fully migrated.

The dashboard reads connection status via `GET /api/integrations/status`, which returns only non-secret metadata (`status`, `mode`, `connectedAt`, `lastSync`, `lastSyncStatus`, `offices`) — never the credential values, even to the account owner, since the UI never needs to display them back.

## Security Headers

Configured in `next.config.mjs`:
- `X-Frame-Options: SAMEORIGIN` - Prevents clickjacking
- `X-Content-Type-Options: nosniff` - Prevents MIME sniffing
- `Referrer-Policy: strict-origin-when-cross-origin` - Controls referrer info
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` - Restricts browser APIs
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` - Forces HTTPS

## Twilio SMS Webhook

The inbound SMS webhook at `/api/webhooks/twilio/sms` lets enrolled agents, team members, and superadmins add listings, pull reports, or grab share links via text message. The webhook routes every inbound SMS through an OpenAI tool-calling agent (GPT-4o) that has short-term conversation memory and uses tools to hit the real services.

### Signature verification
Every request is authenticated with `X-Twilio-Signature` — an HMAC-SHA1 of `fullURL + sortedParamString` using `TWILIO_AUTH_TOKEN`. Requests without a valid signature are rejected with 403. See `verifySignature()` in `src/app/api/services/twilioService.js`.

### Phone enrollment
Three enrollment paths, all keyed on E.164:
1. **Account owners** — **Dashboard → Settings → SMS Shortcuts** → `/api/users/sms-settings` (auth-gated via `verifyAuth`).
2. **Team members** — **Dashboard → Team** (or the inline "Add agent" flow on add/edit property) writes `smsPhone` + `smsEnabled` onto the `agents/{id}` sub-profile. Sender lookup walks `agents → parent user`, so the parent account owns the listing and receives PDF emails.
3. **Superadmins** — **Dashboard → Admin → Users** exposes an SMS column + edit modal so an admin can assign their own phone (or any user's) via the admin users `PATCH /api/admin/users` endpoint.

All writes normalize to E.164 via `src/app/utils/phone.js` (`normalizeE164`) and reject duplicates across both `users` and `agents` collections. Unknown senders are silently ignored (empty `<Response/>` 200 so Twilio doesn't retry) to avoid spam replies.

### Sender resolution
`findSenderByPhone()` in `userLookupService.js` returns a unified sender record:
```
{ uid, email, firstName, superAdmin, senderKind: 'user'|'agent', senderName, agent?, smsPhone }
```
`senderKind === 'agent'` means a team member texted — `uid` is still the parent account and `senderName` is the agent's first name (used by the AI to greet them personally).

### AI agent loop with memory
`handleInboundSms()` (`smsHandlerService.js`) runs an OpenAI tool-calling loop (max 6 iterations) with these tools:
- `scrapeAndCreateListing(url)` — Puppeteer scrape + create premarket draft
- `findMyProperty(query)` — sender's own listings (fuzzy)
- `getReport(propertyId)` — engagement + PHI summary, emails the full PDF
- `getPublicLink(propertyId)` — public share URL
- `findAnyProperty(query)` / `getAnyReport(propertyId)` — **superadmin only**, scan all properties

Ownership is enforced server-side in every tool via `assertOwnership(sender, property)`. Non-admins cannot read or report on listings they don't own, even if the AI gets confused about what to call.

### Conversation history
Every turn (user, assistant, tool result) is written to `smsConversations/{phoneKey}/messages/{autoId}` via `smsConversationService.js`, where `phoneKey` is the E.164 number with the `+` stripped. On each inbound SMS the handler loads the last 12 messages and passes them to the model for short-term memory (so "report for that one" after an earlier "add this" makes sense).

### Error surfacing during beta
Handler failures (and fallback crashes in the webhook) send the error message back to the sender as SMS so we can debug from a real device. Remove or gate behind an env flag once the integration is stable.

### Deferred processing
Twilio requires a response within 15s, but Puppeteer scraping + PDF generation takes 10-30s. The webhook verifies the signature, looks up the sender, ACKs immediately with empty TwiML, and hands the real work to `handleInboundSms()` via Next.js `after()`. Replies are sent via the Twilio REST API (not TwiML) so they survive past the request window.

### Rate limiting & idempotency
- **Rate limit**: 10 SMS commands per rolling hour per parent user, tracked on the user doc via a Firestore transaction. Team members share the parent's budget.
- **Idempotency**: `MessageSid` is stored in `smsMessages/{sid}` on first processing. Retries from Twilio are deduped.

### Firestore composite indexes required
Sender lookups need two composite indexes:
- **`users`**: `smsPhone ASC` + `smsEnabled ASC`
- **`agents`**: `smsPhone ASC` + `smsEnabled ASC`

Property queries (already used elsewhere):
- **`properties`**: `userId ASC` + `createdAt DESC`
- **`properties`**: `createdAt DESC` (platform-wide admin scan)

Firestore will surface a one-click create link the first time each query runs in a new environment.

### URL allowlist for scraping
`scrapeAndCreateListing` only accepts `realestate.com.au` URLs. Enforced twice: in the OpenAI tool schema (instruction) and defensively in `scrapeRealEstateUrl()`.

### Required env vars
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — REST client + signature verification
- `TWILIO_PHONE_NUMBER` — outbound reply sender
- `NEXT_PUBLIC_TWILIO_PHONE_NUMBER` — displayed on settings page
- `OPENAI_API_KEY` — agent loop model (GPT-4o)
- `CHECK_PROPERTY_URL` — Firebase `/check-property` Puppeteer endpoint

## Checklist for New Features

- [ ] API route uses `verifyAuth` or `verifyAdmin` middleware
- [ ] Client uses `authFetch` (web) or `AuthHttp` (Flutter) instead of raw `fetch`/`http`
- [ ] No client-provided UIDs trusted for authorization (use `auth.uid` from token)
- [ ] Firestore rules enforce ownership checks where applicable
- [ ] File uploads validate size and type
- [ ] No secrets hardcoded in client-side code
- [ ] Admin routes use `verifyAdmin`, not just `verifyAuth`
