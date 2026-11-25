# Marketing channel links (Email / SMS / General)

Agents can hand out the same campaign through different channels and see which channel brings in views and
anonymous price opinions, without anything being learned about individual buyers.

## The links

| Link | Example | Counted as |
|---|---|---|
| General link (unchanged) | `premarket.homes/prop4827319056` | General / Unknown |
| Email link | `premarket.homes/prop4827319056e` | Email |
| SMS link | `premarket.homes/prop4827319056s` | SMS |

- All three open the very same buyer page. Each is the campaign's one prop number plus one letter (31 characters, one more than the general link).
- No new numbers are created. Existing campaigns get Email and SMS links immediately; nothing needs recreating.
- `/prop…`, `/p/{code}` and `/find-property?propertyId=…` links all keep working, unchanged, and count as General / Unknown.
- The letter accepts any case and a trailing full stop, like the plain link (`PROP4827319056S.`).
- An unknown letter is a 404, never silently treated as the general link.
- The canonical and link-preview address stays the plain prop link.
- Code:
  - `src/app/utils/campaignChannels.js`: the channel list
  - `src/app/utils/shortLinks.js`: `parsePropSlug`, `propLinkUrl(number, origin, channel)`
  - `next.config.mjs`: the `/prop` rewrite accepts `[EeSs]`
- To add a channel later (e.g. a QR sign):
  - add one entry with a new, never-reused letter
  - add the letter to the rewrite

Agents copy the links from the campaign report: Marketing Channel Performance, then Share campaign. The existing Copy link button still copies the general link.

## What is counted, exactly

| Metric | Definition |
|---|---|
| **Views** (per channel) | Every open of the buyer page through that channel's link. The rule is exactly the one behind Total Views (`stats.views`): a repeat visit counts again, the listing agent viewing their own listing while signed in does not count, and preview deployments count nothing. Suspected link scanners are counted, as they are in Total Views. A channel view is counted only after the Total Views increment succeeds, so channel views are always part of Total Views. |
| **Price opinions** (per channel) | NEW anonymous web price opinions created on a page that was opened through that channel's link. Each opinion is counted once, when created. Editing it later never counts again and never moves it to another channel. |
| **General / Unknown** | Total minus Email minus SMS, for views and for price opinions. It covers the general link, `/p/` links, the full link, the iPad (open-home) screen, opinions given while registering interest, and all activity from before channel links existed. History is never re-labelled or guessed. |
| **Total** | Views = Total Views (`stats.views`). Price opinions = the report's price-opinion count (`summary.priceCount`: opinions with an amount, excluding any Premarket excluded). The Price Opinions card also counts registrations made without a price, so it can be higher. |
| **Conversion** | Price opinions ÷ views, as a whole percentage (capped at 100%, blank with no views). Views include repeat visits, so this is "opinions per 100 opens of the link", not per person. |

What a channel measures is **the link that was opened**, not how the buyer first heard about the campaign. A forwarded email link counts as Email, and a link copied from the page's own address bar keeps its letter. The dashboard says this in plain words.

Opinions are not counted under a channel when:

- the opinion record already carries a registration or an account (only older records, from before price opinions and registrations were stored apart; see `docs/buyer-privacy.md`)
- they came from the iPad (open home) screen
- they are older than 30 minutes when the page asks
- the network call fails

All of these stay in General / Unknown: under-counting a channel is always preferred to guessing.

If an opinion that was credited to a channel is later excluded by Premarket, it stays in its channel's count. By design, nothing records which channel it came from. If that ever makes the channels add up to more than the total, opinions by channel are withheld rather than shown wrongly.

## Privacy design

Premarket's promise is that price opinions stay anonymous. Channel tracking is built so that it can only answer "how did each link perform?" and never "which link did this buyer use?".

**Stored.** Both collections are server-only: the default-deny rule applies (no rules change), and they are reached only through the Admin SDK.

- `campaignChannelStats/{propertyId}` holds `{ propertyId, email: { views, opinions }, sms: { views, opinions } }`. These are running totals only: no buyer, visitor, session, offer id, amount, timestamp or order.
- `campaignChannelGuards/{propertyId}` holds `{ h: [...] }`, a sorted list of 16-character one-way hashes of counted opinion ids. Its only job is to count each opinion once.
  - It never says which channel an opinion was counted under.
  - Sorting removes any order.

**Never stored.** The channel is not written to `offers` (the opinion), `propertyViews`, `propertyViewSessions` or `propertyEngagement`, and is not pushed to analytics events.

- Those records carry visitor and session ids, and older `offers` records can hold a registration on the same record as the opinion. New registrations are separate records (`docs/buyer-privacy.md`), and the database rules refuse an unknown field such as a channel on any `offers` record.
- A per-record channel there would let an opinion be traced to a channel, and then to a person.
- The new system does not build on that older linkage. It never processes an opinion record that carries a registration or an account.

**Crediting an opinion** (`POST /api/offers/opinion-channel`). The buyer page calls it right after creating a new opinion, when the page was opened through a channel link. The server counts the opinion only if every condition holds:

- the opinion exists and is an anonymous web price opinion for the campaign named
- it was created by the same browser tab (its `sessionId` matches)
- it was created within the last 30 minutes
- it has not been counted before

The route always answers `{ ok: true }`, so it cannot be used to probe opinions. It returns no figures.

**Reading.** Channel figures appear only in the campaign report (`GET /api/properties/[id]/report`), behind the same access check as the rest of the report. They are shown to the owner, office admins, the managing BSO, team managers and teammates, all of whom get the same privacy-checked figures. They are not in vendor reports, the emailed report, leadership reports or public pages. The property document, which is publicly readable, holds none of them.

### Small groups

An agent controls who receives each link. Without safeguards, an agent could send the SMS link to a single buyer, watch SMS opinions go from 0 to 1, and match that buyer to the new amount in the report's list of anonymous opinions. So the server (`src/app/api/services/channelReport.js`) applies these rules before anything reaches the browser:

1. **No amounts, medians, dates, times or order by channel.** Only counts.
2. **A channel's opinion count is shown only when it is at least 3.** This is the same minimum the report uses for group medians. Below 3, including zero, it is withheld (shown as a lock). A zero is withheld too, because a later change from 0 to 1 would give the buyer away.
3. **A withheld figure can never be worked out from the total.**
   - If only one channel would be withheld, the next smallest is withheld with it, and those channels are shown only as one combined figure.
   - The combined figure must be at least 3. Otherwise every channel's opinions are withheld, and only the campaign total is shown, as it always has been.
   - Ties are broken by a fixed order, never by views, so the grouping cannot flip back and forth.
4. **Views per channel are always shown.** They are not linked to any price.
5. With no opinions at all, every count is simply 0.

Unit tests check these rules for every combination of up to 7 opinions per channel (`tests/unit/channel-attribution.test.js`):

- No shown count for a used channel is under 3.
- Withheld channels are never exactly one, and together they are at least 3.
- Moving an opinion from one withheld channel to another changes nothing on screen.
- Views alone never change the grouping.

### Residual risks (stated plainly)

- **Watching over time.** Live counts cannot fully stop a determined agent who sends a link to a hand-picked group and records every refresh. They can sometimes narrow down, with some probability, whether that group responded. This is already true today of the campaign's total opinion count and its list of anonymous amounts. The rules above stop a single figure from singling anyone out at any moment, and make the obvious attack (one buyer, one link) show nothing.
  - Optional further hardening, not built: refresh channel opinion figures hourly or daily instead of live.
- **Collusion.** If two of the 3 people in a channel are cooperating with the agent, the third can be exposed. No minimum-group rule can prevent that.
- **Operator access.** Like the Open Home pilot, someone with administrator access to the live database could, for about an hour (Firestore keeps old versions for 3,600 seconds and point-in-time recovery is off), compare when an opinion was created with when a channel total changed.
  - Agents and offices have no such access.
- **Analytics.**
  - Fixed by the buyer privacy change this branch builds on (`docs/buyer-privacy.md`): the buyer page no longer sends any opinion amount, session id or buyer detail to Google Tag Manager.
  - A channel letter in the page address is visible to analytics as part of the page URL, as any UTM tag would be. No channel is added to analytics events.

## Testing

- Unit:
  - `tests/unit/channel-attribution.test.js`: report rules, small-group checks, recording, both routes, buyer-page guards
  - `tests/unit/channel-performance-ui.test.js`: share buttons and table
  - `tests/unit/short-links.test.js`: link format, rewrite and page
- Browser, against a local production build on the staging Firebase project: separate devices open the Email, SMS and general links plus the legacy and full links, repeat visits, forwarded and capitalised links, an unknown letter, iPad mode, opinions, an edit and a registration. The test also tries crafted calls, checks report access and database rules, and runs the dashboard copy buttons on desktop and phone.
