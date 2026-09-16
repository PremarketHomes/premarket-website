'use client';

import { Hand, RefreshCw, Wifi, ShieldCheck } from 'lucide-react';
import PublicSiteNav from '../../components/public-site/PublicSiteNav';
import { playfairDisplay } from '../../components/property-page/fonts';
import PublicSiteFooter from '../../components/public-site/PublicSiteFooter';
import {
  MarketingHero,
  SectionHeading,
  FeatureCard,
  ClosingCTA,
  TwoColumn,
  BulletList,
} from '../../components/marketing/MarketingShell';

export default function AgentIpadClient() {
  return (
    <div className={`bg-white text-slate-900 ${playfairDisplay.variable}`}>
      <PublicSiteNav />
      <MarketingHero
        eyebrow="Agent iPad"
        title={
          <>
            A kiosk mode for the{' '}
            <span className="bg-gradient-to-r from-[#e48900] to-[#c64500] bg-clip-text text-transparent">
              open home
            </span>
            .
          </>
        }
        subtitle="Open the Premarket kiosk in Safari on any iPad. A buyer taps through their price opinion, then it resets — ready for the next person. Nothing to install."
        primaryCta={{ href: '/join', label: 'Get started' }}
        secondaryCta={{ href: '/features', label: 'All features' }}
      />

      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <SectionHeading
            align="center"
            eyebrow="What it does today"
            title="A simple, purpose-built kiosk"
            subtitle="It does one thing well: capture a buyer's price opinion in person, then get out of the way."
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <FeatureCard
            icon={Hand}
            title="Big-finger UX"
            description="A large, purpose-built touch slider designed to be handed to a buyer with no instructions."
            accent="orange"
          />
          <FeatureCard
            icon={RefreshCw}
            title="Resets between buyers"
            description="Each session resets automatically once it's done — ready for the next person, no manual clearing."
            accent="emerald"
          />
          <FeatureCard
            icon={Wifi}
            title="No separate sync step"
            description="Opinions submitted on the kiosk are the same data as your dashboard and reports — there's no separate app to sync."
            accent="blue"
          />
          <FeatureCard
            icon={ShieldCheck}
            title="Secure by default"
            description="Runs over HTTPS with Firebase Authentication — the same security as the rest of Premarket."
            accent="violet"
          />
        </div>
      </section>

      {/* Use cases */}
      <section className="bg-slate-50 border-y border-slate-200/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
          <TwoColumn
            left={
              <div>
                <SectionHeading
                  eyebrow="Where it's used"
                  title="A few moments it's built for"
                  subtitle="Nothing exotic — just the moments where handing over a device makes sense."
                />
              </div>
            }
            right={
              <BulletList
                accent="orange"
                items={[
                  {
                    title: 'At the open home',
                    body: 'Buyers tap in their price opinion before they leave. You walk away with real opinions, not scribbled phone numbers.',
                  },
                  {
                    title: 'On a private inspection',
                    body: 'Hand it over on the front step. Capture the opinion before the conversation drifts elsewhere.',
                  },
                  {
                    title: 'During a vendor meeting',
                    body: 'Open the report right in front of the seller and show them the evidence directly.',
                  },
                ]}
              />
            }
          />
        </div>
      </section>

      <ClosingCTA
        title="No app to install"
        subtitle="Free with every Premarket account. Just open it in Safari on any iPad."
        primaryHref="/join"
        primaryLabel="Get started"
        secondaryHref="/contact"
        secondaryLabel="Talk to us"
      />

      <PublicSiteFooter />
    </div>
  );
}
