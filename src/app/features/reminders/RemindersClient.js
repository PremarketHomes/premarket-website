'use client';

import { Mail, Calendar } from 'lucide-react';
import PublicSiteNav from '../../components/public-site/PublicSiteNav';
import { playfairDisplay } from '../../components/property-page/fonts';
import PublicSiteFooter from '../../components/public-site/PublicSiteFooter';
import {
  MarketingHero,
  SectionHeading,
  FeatureCard,
  ClosingCTA,
} from '../../components/marketing/MarketingShell';

export default function RemindersClient() {
  return (
    <div className={`bg-white text-slate-900 ${playfairDisplay.variable}`}>
      <PublicSiteNav />
      <MarketingHero
        eyebrow="Reminders"
        title={
          <>
            A simple{' '}
            <span className="bg-gradient-to-r from-[#e48900] to-[#c64500] bg-clip-text text-transparent">
              check-in
            </span>
            , automatically.
          </>
        }
        subtitle="Premarket emails you at 14 and 30 days to check whether the property has sold — one less thing to remember to follow up on manually."
        primaryCta={{ href: '/join', label: 'Get started' }}
        secondaryCta={{ href: '/features', label: 'All features' }}
      />

      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="text-center mb-16 max-w-2xl mx-auto">
          <SectionHeading
            align="center"
            eyebrow="What it does today"
            title="One scheduled check-in, sent to you"
            subtitle="This is deliberately simple — a timed email, not an automated buyer-nudging system."
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <FeatureCard
            icon={Calendar}
            title="Day 14 and day 30"
            description="If a property is still active two and four weeks after it was added, Premarket emails you a check-in — has it sold yet?"
            accent="orange"
          />
          <FeatureCard
            icon={Mail}
            title="Sent to the agent"
            description="This reminder goes to you, the agent — not to buyers. It's a scheduling aid, not a buyer follow-up or re-engagement tool."
            accent="blue"
          />
        </div>
      </section>

      <ClosingCTA
        title="One less thing to track"
        subtitle="A small, honest feature — part of every Premarket campaign."
        primaryHref="/join"
        primaryLabel="Get started"
        secondaryHref="/contact"
        secondaryLabel="Talk to us"
      />

      <PublicSiteFooter />
    </div>
  );
}
