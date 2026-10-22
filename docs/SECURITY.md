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

## Removed: Twilio SMS Webhook ("SMS Shortcuts")

The inbound SMS webhook (`/api/webhooks/twilio/sms`), its OpenAI tool-calling
agent, and every enrollment surface (Settings, Team, Admin → Users) were
removed — unused legacy functionality, confirmed via audit to have no active
enrollment. See the audit/removal PR for the full writeup.

Security note from that audit, preserved here since it's a general lesson
beyond this one feature: the feature had stored each enrolled agent's
personal mobile number directly on the publicly-readable `users`/`agents`
documents (`smsPhone`/`smsEnabled`). Firestore rules cannot restrict
individual fields on an otherwise-public document, so this was a real PII
exposure independent of whether the app's own UI ever rendered it. Never
add a phone number, or any other field not meant for public consumption,
directly onto `users`/`agents` again — give it its own locked-down document
instead (see `integrationCredentials` above for the existing pattern).

## Checklist for New Features

- [ ] API route uses `verifyAuth` or `verifyAdmin` middleware
- [ ] Client uses `authFetch` (web) or `AuthHttp` (Flutter) instead of raw `fetch`/`http`
- [ ] No client-provided UIDs trusted for authorization (use `auth.uid` from token)
- [ ] Firestore rules enforce ownership checks where applicable
- [ ] File uploads validate size and type
- [ ] No secrets hardcoded in client-side code
- [ ] Admin routes use `verifyAdmin`, not just `verifyAuth`
