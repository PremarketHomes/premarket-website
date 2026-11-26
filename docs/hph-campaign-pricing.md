# HPH campaign pricing: retail ($199) vs wholesale ($200)

Approved November 2026 by Dave Manby (HPH) and Luke Wilson: the HPH campaign price is **$199 total per campaign**,
payable by **either the agent or the vendor**. HPH subsidises the rollout.

## Two separate prices

| | Retail (what HPH people are told) | Wholesale (what Premarket invoices) |
|---|---|---|
| Where it lives | `officeAdminInfo/{officeId}.retailCampaignPrice`, plus `retailCampaignPayer` | `settings/invoicing.pricePerListing` (global, every agency) |
| HPH value | $349 → **$199** (data step below) | **$200**, no GST (Premarket isn't GST-registered) |
| Read by | `campaignPricingService`, i.e. the add-campaign fee notice and the retail terms (agents, BSOs and office admins: the lookup is the caller's own office) | `billingService` (`propertyCharges`), invoice runs, agency invoice, Xero |
| Effect on money | None: display and terms only | One charge per campaign to the agency (HPH office), invoiced on a rolling 30-day cycle, due in 14 days |

Neither side reads the other. `tests/unit/hph-retail-pricing.test.js` enforces that.

**`retailCampaignPayer`** (new, optional):
- `'vendor'` or absent keeps the original wording: "payable by the vendor (Seller) through the agent's agency". It is unchanged for any office that doesn't set it.
- `'agent_or_vendor'`: "$X AUD in total per campaign … payable by either the agent or the vendor (Seller), through the agent's agency".
- Any other value fails closed: the page shows Retry instead of a figure.

Who pays HPH (agent or vendor) is HPH's own process. Premarket only ever bills the agency. Nothing here collects a payment.

## What $199 vs $200 means

Under the current setup, every non-free HPH campaign creates a **$200** charge to HPH. HPH collects **$199** from the
agent or vendor, so **HPH carries $1 per campaign**. It also gives up the $149 it used to keep at the old $349 price.

If instead the intent is that Premarket's charge to HPH is $199, the wholesale price must change. That needs separate approval, because:
- `pricePerListing` is **global**, so changing it changes every agency's charge; or
- an HPH-only wholesale rate needs a new per-office billing override (a billing code change), plus a decision on whether it applies only to campaigns created after a date.

Existing charges and invoices are never recalculated either way.

## Go-live order

1. Merge and deploy this code. Nothing visible changes: HPH still has $349 and no payer field, so the original wording shows.
2. With approval, set HPH's office record to `retailCampaignPrice: 199` and `retailCampaignPayer: 'agent_or_vendor'`.
   - Use one atomic, precondition-guarded write with a backup and an `officeCampaignAudit` entry.
   - Rollback is the same write in reverse.
3. Check: the HPH add-campaign page shows "$199 AUD total per campaign" and "either the agent or the vendor".
