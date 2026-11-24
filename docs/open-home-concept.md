# Open Home Experience: concept prototype

A proposed feature, built as a working prototype for presenting to partner offices. A buyer scans one QR code at
the open home, checks in on their phone, inspects, leaves an anonymous price opinion (or skips it) and finishes on a
green "Visit complete" screen. The agent runs the open home from a live dashboard.

**Status: concept only.** Demo data in the browser. Nothing reads or writes live Premarket data, sends email or SMS,
or touches a campaign, the iPad kiosk, billing or permissions.

## Pages

| Path | What | Access |
| --- | --- | --- |
| `/concepts/open-home` | Pitch presentation (arrow keys / space move between sections; `?for=Name` adds a "Prepared for" line) | Private* |
| `/concepts/open-home/demo` | Presenter view: the buyer's phone next to the agent's live dashboard | Private* |
| `/concepts/open-home/agent` | Agent dashboard: choose property → start → live → end → summary | Private* |
| `/concepts/open-home/sign` | Entrance QR sign: A4, A3, A-frame (600×900 mm), iPad screen; dark or light; print / PDF | Private* |
| `/concepts/open-home/visit?property=…&session=…` | The buyer's phone page the QR opens | Open (demo only) |

\* Private. On production (`VERCEL_ENV=production`) they open for:
- a signed-in platform admin (`users.superAdmin`), or
- anyone who opened the **private share link** `https://premarket.homes/concepts/open-home/share/<token>`. No
  Premarket account is needed.

On Vercel previews and local dev they open directly; previews sit behind Vercel's own login.

The buyer page is open so any phone can scan a demo sign. Everything typed there stays in that phone's browser.

Every page is `noindex` and none is linked from navigation.

### Private share link (`_lib/shareAccess.js`, `share/[token]/route.js`)
- **How it works:**
  - Opening the link checks the token, stores it in an HttpOnly, SameSite=Lax cookie (Secure on https) for
    `/concepts/open-home` only, lasting 90 days.
  - It then redirects (303) to the pitch at its clean address, so the token leaves the address bar.
  - The presenter pages re-check the cookie on every load. A wrong token gets the same redirect with no cookie, so it
    lands on the neutral private page.
- **Security:**
  - The token is 192 random bits.
  - Only its SHA-256 is in the code, because the repo is public. Comparison is constant-time.
  - The response isn't cached. The site's Referrer-Policy never sends the path, and so the token, to other sites.
  - The cookie is not read anywhere else in the app, and grants nothing outside the concept. The concept itself is
    demo data only.
- **Add a link:** add `{ id, sha256 }` to `SHARE_LINKS`, or put the hash in the `OPEN_HOME_SHARE_SHA256`
  environment variable (comma-separated).
- **Revoke a link:** remove its hash and deploy. Browsers that opened it lose access on their next page load.

## What is reused

- `PriceOpinionSlider` and `computePriceOpinionRange`: the same slider, $10,000 steps and ±25% property range as the
  property page and kiosk. No dollar figure is shown and Submit stays disabled until the buyer moves it (existing rule).
- Office co-branding from `components/office-landing/offices.js`: name, colours and the supplied HPH logos. No office
  logo was drawn or edited. Premarket logos are the live files. A listing with no office shows Premarket only.
- `normalizeE164` (mobile validation), the kiosk's email rule, the `--brand-*` colour variables, Playfair headings.
- New and reusable: `utils/qrCode.js` + `components/QrCode.js`, a dependency-free QR generator that draws SVG in
  the browser. The only previous QR in the platform was an image from a third-party service (api.qrserver.com) in
  one email. It was checked against an independent decoder: 124 payloads, versions 1–36, all masks and error levels,
  plus damage tests.

## Privacy design (the part a production build must keep)

Requirement: a buyer's name, phone and email must never be associated with their price opinion, and that has to
hold in the data, not just on screen.

**Finding on the existing platform:** the current campaign page and iPad kiosk store a buyer's registration on the
**same `offers` document** as their price opinion. The kiosk does this on purpose (`docId = opinion.id`, see
`kioskPersistence.buildRegistrationItem`), and opinions also carry `sessionId` and `visitorId`. Reports keep the two
apart (`api/services/opinionPrivacy.js`), but the stored data links them. So this feature is **not** built on `offers`,
and the prototype uses isolated demo stores instead of claiming the existing model is anonymous.

How the prototype separates them (`concepts/open-home/_lib`):

1. **Two flows that never meet.** `attendanceStore` holds identity (name, mobile, email, check-in minute, interest).
   `opinionStore` holds amounts only. Neither module imports the other. Tests enforce this.
2. **The opinion request carries only `(session, amount)`.** It has no check-in reference, name, device id or
   timestamp. Amounts are stored sorted, so arrival order is lost too.
3. **The agent gets aggregates only** (`opinionSummary.js`):
   - While live: a count in steps of 5 ("Fewer than 5", "5+", "10+"). No prices.
   - After the open home ends: the typical opinion, the middle half and the spread, only with **5 or more** opinions.
     That is stricter than the report's existing minimum of 3.
   - Never: an individual amount, who gave one, or when.
4. **No per-buyer opinion status.** The attendance list has no opinion column. The completion screen looks identical
   whether or not the buyer gave an opinion; only the small subtitle differs. So an agent can't tell from across the
   room either.
5. **Register interest is an identity action.** It reuses the check-in details and never includes an opinion. It is
   offered whether or not an opinion was given, so registering implies nothing.
6. **The buyer's phone** remembers its own progress so it can reopen. It stores whether this buyer gave an opinion,
   never the amount.
7. Sentry Replay is told to mask the check-in form and block the opinion screen (`data-sentry-mask` /
   `data-sentry-block`).

## What production needs (not in the prototype)

1. **Server storage, server-only rules.** Two new collections behind API routes (Admin SDK), both default-deny like
   `propLinks`:
   - `openHomeSessions/{id}` with `attendance/{autoId}` for identity.
   - A separate aggregate for opinions: one document per session holding the sorted amounts and a count, updated in
     a transaction. No per-opinion document, no timestamp, no IP.
   - Agents read opinions only through an API that applies the rules in `opinionSummary.js`.
2. **Request hygiene on the opinion endpoint.**
   - No auth header, cookie or check-in reference is sent or read.
   - No application logging of IP or user agent.
   - No analytics event with identity.
   - Exclude the buyer pages from Sentry Replay, and set `sendDefaultPii: false` for them. Today it is `true`
     site-wide.
   - Residual risk to state honestly: Vercel's own platform logs keep request IP and time for both calls. Only
     Premarket staff can see them, not agents. Keep their retention short.
3. **Abuse limits without linking.**
   - Cap opinions at the session's check-ins plus a margin.
   - Rate-limit per session.
   - One opinion per phone, via a random device token that is unrelated to the check-in.
   - If stronger guarantees are needed later, use blind-signed tokens.
4. **Live dashboard across devices.** Firestore listeners or polling of the two server APIs. The demo syncs only
   between tabs of one browser.
5. **Sessions on real campaigns.**
   - Start an open home from the campaign page next to "Open Home (iPad)".
   - Use a short QR link, for example a session code on the prop-link system.
   - Co-branding comes from the campaign's office brand (`agencyBrands`), as the property page already does.
6. **Where check-ins go.**
   - The agent's contacts and the campaign report, as attendance and registrations.
   - Never merged into `offers`, and never shown next to an amount.
   - Decide retention, and the export/CSV policy.
7. **Wording and consent.** Have the collection notice, the optional marketing opt-in and the privacy policy reviewed
   for the Australian Privacy Principles, and with the partner office.
8. **Existing flows (separate decision).** If the kiosk and campaign page should meet the same standard, they need
   to stop writing registrations onto the opinion document. That is a change to live data flows, deliberately not
   made here.
9. **Pilot** at a few open homes, then measure. No results are claimed anywhere in the concept.
