# For legal review: administrator accepting campaign terms on an agent's behalf

Needed before HPH uses managed campaign creation. Nothing has been rewritten; this lists exactly what exists today.

## What happens
In the Add Property wizard, an HPH office administrator (or a team creator) can create a campaign **for another agent**. At the Terms step they tick
**"I have read and agree to the terms and conditions"** and the campaign is submitted. The assigned agent does not see or accept anything.

New text shown only in that situation (above the checkbox):
> You are accepting these terms yourself, as the person creating this campaign for {agent}. The agent has not personally accepted them. Your acceptance is recorded against your name.

Recorded on the campaign: `termsAcceptedAt` and `termsAcceptedBy` (the administrator's user id), plus `createdByUid`/`createdByRole`. The agent is the campaign owner.
Nothing else in the system reads these fields.

## Terms the administrator is shown (HPH, live today)
The standard agent terms (12 sections, Premarket Group Pty Ltd), with section 6 replaced for HPH by:
> 6. Payment Terms. **Campaign Fee:** The Premarket campaign fee is $349 AUD per campaign. **Vendor Paid:** The campaign fee is payable by the vendor (Seller) through the agent's agency.
> **Charge Trigger:** The campaign fee applies upon successful submission of the property and remains payable if the listing is subsequently withdrawn, archived or changes status.

Other clauses that matter here: section 1 ("By using Premarket, **you** agree to these Terms"); section 4 (privacy and information sharing); section 7 (indemnification: "Buyers and Sellers
agree to indemnify..."); and **section 11**: "By uploading content yourself, approving imported images, or providing photos via an agent link, **you confirm that you own the content or have the
right or permission to use it. You grant Premarket and your selected agent a non-exclusive licence** to display and reproduce that content..." Administrators upload photos in this flow.

## Facts counsel needs
1. **Who the acceptor actually is today.** Hannah does not yet have her own login. The HPH administrator is `accounts@premarket.homes`, a **Premarket-controlled account that is also a platform
   super-admin**, not an HPH employee. Until Hannah has a named login, every acceptance would be recorded against that shared Premarket account.
2. **Money:** Premarket invoices HPH (the office, not the agent or vendor) the wholesale price, currently $200 GST-inclusive with no GST charged. HPH's agents and vendors are shown the retail $349. No invoice has been issued yet and automatic invoicing is off; two charges are pending.
3. The terms are written for the person submitting ("you") and for sellers; the fee clause names the agent's agency as payer (standard text) or the vendor through the agency (HPH text).

## Questions
a. May an HPH office administrator accept these terms on behalf of the agency, the agent, and the vendor? What evidence of authority should be kept?
b. Is acceptance by the shared Premarket account `accounts@premarket.homes` acceptable, or must acceptance be by a named HPH person (which would make Hannah's own login a launch requirement)?
c. Must the assigned agent also accept, for example on first login or via the campaign-link email?
d. Does section 11 (ownership confirmation and licence) need adjusting for photos uploaded by an administrator rather than the vendor or agent?
e. Is the new "accepting these terms yourself... the agent has not personally accepted them" note acceptable, or should it be reworded?
