'use client';

import { useState } from 'react';
import { playfairDisplay } from '../property-page/fonts';
import PrototypeNav from './PrototypeNav';
import HeroSection from './HeroSection';
import SendSection from './SendSection';
import EngageSection from './EngageSection';
import OpinionSection from './OpinionSection';
import InterestSection from './InterestSection';
import IntelligenceSection from './IntelligenceSection';
import ProofSection from './ProofSection';
import FinalCtaSection from './FinalCtaSection';
import PrototypeFooter from './PrototypeFooter';

/**
 * VISUAL PROTOTYPE — homepage redesign concept.
 * Approved sequence: Hero -> Send -> Engage -> Opinion -> Interest ->
 * Intelligence -> Proof -> Final CTA -> Footer.
 *
 * Reuses real product pieces where sensible (PriceOpinionSlider,
 * PremarketBadge, BrandMark, the property page's scoped Playfair Display
 * font) rather than inventing fake product interfaces. Everything else is
 * new, isolated markup under components/homepage-prototype/ — nothing in
 * the existing property page, dashboard, or PublicHomepage is modified.
 *
 * This component is only wired into src/app/page.js on this prototype
 * branch, never on main.
 */
export default function HomepageStoryPrototype() {
  const [scrolledPastHero, setScrolledPastHero] = useState(false);

  return (
    <div className={playfairDisplay.variable}>
      <PrototypeNav solid={scrolledPastHero} />
      <HeroSection onPastHero={setScrolledPastHero} />
      <SendSection />
      <EngageSection />
      <OpinionSection />
      <InterestSection />
      <IntelligenceSection />
      <ProofSection />
      <FinalCtaSection />
      <PrototypeFooter />
    </div>
  );
}
