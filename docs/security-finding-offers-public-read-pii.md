# Security finding (FIXED): `offers` collection public-read PII exposure

**Status:** Fixed on branch `fix/offers-public-read-security`. Originally documented (not fixed)
during Phase 1 view/session tracking, per explicit instruction to keep that work unrelated to
this fix. Addressed here as its own dedicated security task.

## What was exposed

`firestore.rules` had:

```
match /offers/{offerId} {
  allow read: if true;
  ...
}
```

`allow read: if true` meant **any client, unauthenticated, could read every document in the
`offers` collection** — not just their own, and not scoped to a single property. This was a
direct Firestore read, not mediated by an API route, so there was no server-side filtering in
front of it.

`offers` documents (created from `src/app/components/PropertyPageClient.js`, the price-opinion /
"register interest" flow) contain, once a buyer registers interest:

- `buyerName`
- `buyerEmail`
- `buyerPhone`
- `offerAmount` (the buyer's private price opinion)
- `propertyId`, `sessionId`, `userId` (when logged in), qualification fields
  (`isFirstHomeBuyer`, `isInvestor`, `buyerType`, `seriousnessLevel`)

So a plain, unauthenticated Firestore query against `offers` (directly via the client SDK, no
login required) could return every buyer's name, email address, phone number, and private price
opinion across every property on the platform — not just the one the requester was looking at.

## Why the rule was like this

Anonymous visitors submit price opinions without logging in, and the client needed to read back
a session-based previous offer (`fetchPreviousOffer` — queried by `propertyId` + `sessionId`) to
pre-fill the widget on a return visit. `allow read: if true` made that lookup simple, without
weighing that it also exposed every *other* buyer's contact details in the same collection to any
reader, not just the ones matching the requester's own session.

## What changed

1. **`firestore.rules`** — `offers` read access is now restricted to:
   - the buyer who owns the offer (`resource.data.userId == request.auth.uid`), or
   - the agent who owns the referenced property (new `isOwnerOfProperty(propertyId)` helper,
     which looks up `properties/{propertyId}.userId` via `get()`), or
   - a superAdmin (existing `isSuperAdmin()` helper, already used elsewhere in the ruleset).

   All three require `isAuth()` — anonymous/unauthenticated reads are now denied outright.
   `create`/`update`/`delete` rules are unchanged (anonymous price-opinion submission still
   works exactly as before).

2. **New route `src/app/api/offers/session-lookup/route.js`** — the one legitimate *anonymous*
   read (an unauthenticated visitor reading back their own previous session-scoped opinion to
   pre-fill the widget) can't be expressed as a Firestore security rule at all: rules have no way
   to verify "the requester already knows this document's `sessionId`" as a credential distinct
   from the document's own stored value. This lookup now happens server-side via the Admin SDK
   (which isn't subject to security rules) and returns **only** `{ offerId, offerAmount }` —
   never `buyerName`/`buyerEmail`/`buyerPhone` or any other field, regardless of what's on the
   document. This route cannot become a new PII leak even if someone else guessed a `sessionId`.

3. **`src/app/components/PropertyPageClient.js`** — `fetchPreviousOffer` now calls
   `/api/offers/session-lookup` instead of querying `offers` directly from the browser. This is
   the only code change to this file; the price-opinion widget's behaviour (pre-fill on return,
   midpoint fallback) is unchanged from the buyer's point of view. Unused Firestore query imports
   (`query`, `where`, `orderBy`, `limit`, `getDocs`) were removed since nothing else in the file
   used them.

## How authorised parties still get the data they need

- **Buyers** viewing their own opinion history (`buyer-dashboard/hooks/useBuyerData.js`, queries
  `where('userId','==',user.uid)`) — allowed via the `resource.data.userId` branch.
- **Agents** viewing opinions/interest on their own properties (`dashboard/page.js`,
  `dashboard/property/[id]/page.js`) — allowed via `isOwnerOfProperty`, which checks the
  referenced property's `userId` against the authenticated caller.
- **SuperAdmins** — CRM contact lookup by email (`dashboard/crm/[id]/page.js`) and the admin
  properties tab (`dashboard/admin/components/tabs/PropertiesTab.js`), both already gated at the
  page/layout level behind `userData.superAdmin === true` — allowed via `isSuperAdmin()`
  regardless of which property the offer belongs to.
- **Server-side reporting/cron/admin routes** (`reportService.js`, `contactComputation.js`,
  `trending-areas`, `market-report`, etc.) all use the **Admin SDK** (`adminDb`), which bypasses
  Firestore security rules entirely — completely unaffected by this change.

## How anonymous buyers still submit opinions/interest without reading other records

`create` and `update` rules on `offers` are untouched — anonymous visitors can still submit and
update their own price opinion exactly as before. The only thing that changed is that they can no
longer *read* the collection directly; the one anonymous read they legitimately need (pre-filling
their own previous opinion) is served by the new narrow, PII-free API route instead.

## Data impact

No existing `offers` documents were modified, migrated, or deleted. This is a rules + one read
API change only.
