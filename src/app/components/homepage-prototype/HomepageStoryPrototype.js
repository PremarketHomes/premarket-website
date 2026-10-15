'use client';

import { useState } from 'react';
import { playfairDisplay } from '../property-page/fonts';
import PublicSiteNav from '../public-site/PublicSiteNav';
import PublicSiteFooter from '../public-site/PublicSiteFooter';
import HeroSection from './HeroSection';
import WinListingSection from './WinListingSection';
import SendSection from './SendSection';
import EngageSection from './EngageSection';
import OpinionSection from './OpinionSection';
import InterestSection from './InterestSection';
import IntelligenceSection from './IntelligenceSection';
import PricingSection from './PricingSection';
import FinalCtaSection from './FinalCtaSection';

/**
 * Homepage — commercial rebuild on top of the original visual prototype.
 * Sequence: Hero -> Win the Listing -> Send -> Engage -> Opinion ->
 * Interest -> Intelligence -> Pricing -> Final CTA -> Footer.
 *
 * The original sequence (Hero -> Send -> Engage -> Opinion -> Interest ->
 * Intelligence -> Final CTA) was buyer-engagement-led — it explained the
 * mechanism well but never told a listing agent, in the first viewport,
 * that this is how you win the appraisal. Win the Listing and Pricing are
 * new; everything else is the same component, lightly reworded where it
 * conflated a price opinion with a personal offer or missed a chance to
 * tie back to the commercial outcome. No "Proof" section — no real case
 * studies or testimonials exist yet to put there honestly; see the
 * homepage transformation report for what's needed before one can be
 * added without fabricating anything.
 *
 * Reuses real product pieces where sensible (PriceOpinionSlider,
 * PremarketBadge, BrandMark, the property page's scoped Playfair Display
 * font) rather than inventing fake product interfaces. Everything else is
 * isolated markup under components/homepage-prototype/ — nothing in the
 * property page, dashboard, email, or Firestore rules is touched.
 */
export default function HomepageStoryPrototype() {
  const [scrolledPastHero, setScrolledPastHero] = useState(false);

  return (
    <div className={playfairDisplay.variable}>
      <PublicSiteNav solid={scrolledPastHero} howItWorksHref="#send" howItWorksLabel="How it works" />
      <HeroSection onPastHero={setScrolledPastHero} />
      <WinListingSection />
      <SendSection />
      <EngageSection />
      <OpinionSection />
      <InterestSection />
      <IntelligenceSection />
      <PricingSection />
      <FinalCtaSection />
      <PublicSiteFooter />
    </div>
  );
}
