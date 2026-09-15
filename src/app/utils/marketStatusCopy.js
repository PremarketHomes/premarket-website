/**
 * Market-status-aware buyer copy for the public property page.
 *
 * Premarket already has a `listingStatus` field on every property
 * (set by the agent in the Add/Edit Property forms — see
 * dashboard/add/page.js and dashboard/edit/[id]/page.js): 'on-market' or
 * 'premarket' (the default for anything else, including missing/legacy
 * data). This is the ONLY thing that decides which copy variant below is
 * shown — there is no separate/new status system here.
 *
 * The page must never contradict this status: an on-market property must
 * never say "before it hits the market" / "secure it pre-market" / etc,
 * and a pre-market property's copy should make the early-access
 * opportunity clear. Every buyer-facing string that depends on market
 * status is centralised here so the whole page can only ever pull from
 * one of these two consistent sets.
 */
export function isOnMarket(listingStatus) {
  return listingStatus === 'on-market';
}

export function getMarketStatusCopy(listingStatus) {
  if (isOnMarket(listingStatus)) {
    return {
      isOnMarket: true,
      priceOpinionHeading: 'What do you think this property is worth?',
      priceOpinionSubcopy:
        'Share your anonymous price opinion and help provide a clearer picture of where buyers see value in today’s market.',
      interestHeading: 'Interested in this property?',
      interestSubcopy: 'Register your interest directly with the agent.',
    };
  }

  return {
    isOnMarket: false,
    priceOpinionHeading: 'What do you think this property is worth?',
    priceOpinionSubcopy:
      'Share your anonymous price opinion and help the owner understand the property’s true value before it launches to market.',
    interestHeading: 'Interested in securing it before it hits the market?',
    interestSubcopy:
      'Register your interest directly with the agent and explore the opportunity to secure a pre-market deal.',
  };
}
