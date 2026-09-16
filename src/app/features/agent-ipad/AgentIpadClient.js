'use client';

import {
  Tablet,
  Wifi,
  Hand,
  PenTool,
  RefreshCw,
  ShieldCheck,
  Camera,
  Sparkles,
  Zap,
} from 'lucide-react';
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
            Designed for the{' '}
            <span className="bg-gradient-to-r from-[#e48900] to-[#c64500] bg-clip-text text-transparent">
              open home
            </span>
            — and everywhere else.
          </>
        }
        subtitle="A purpose-built iPad app for capturing buyer price opinions, feedback and contact details in the field. Walk in. Hand it to the buyer. Watch the data flow into your campaign live."
        primaryCta={{ href: '/join', label: 'Get the app' }}
        secondaryCta={{ href: '/features', label: 'All features' }}
      />


      {/* Designed for the field */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <SectionHeading
            align="center"
            eyebrow="Designed for the field"
            title="A tool that earns its place on your bag"
            subtitle="Most field apps are CRMs in disguise. The Agent iPad app does one thing brilliantly — capture buyer feedback the moment it happens, then disappears."
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <FeatureCard
            icon={Hand}
            title="Big-finger UX"
            description="Designed to be handed to a buyer with no instructions. Tap a price. Tap a star. Done."
            accent="orange"
          />
          <FeatureCard
            icon={Wifi}
            title="Offline-first"
            description="Captures everything offline and syncs the moment you're back on signal. Never miss feedback because of bad reception."
            accent="blue"
          />
          <FeatureCard
            icon={RefreshCw}
            title="Live sync to web"
            description="Every opinion you capture in the open home appears in your web dashboard within seconds."
            accent="emerald"
          />
          <FeatureCard
            icon={PenTool}
            title="Quick notes"
            description="Tap-to-add private notes against any buyer or property — quotes, body language, who they came with."
            accent="violet"
          />
          <FeatureCard
            icon={Camera}
            title="Photo capture"
            description="Snap a photo of the buyer's signed-in details, an ID, or a contract page. It attaches to the right record automatically."
            accent="rose"
          />
          <FeatureCard
            icon={ShieldCheck}
            title="Privacy locked"
            description="Locks itself between buyers. PIN-protected. No buyer ever sees the previous person's data."
            accent="orange"
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
                  eyebrow="Where it shines"
                  title="Three moments the iPad app is unbeatable"
                  subtitle="Field tools live or die on their use cases. Here are the three moments most agents tell us they can't imagine going back."
                />
              </div>
            }
            right={
              <BulletList
                accent="orange"
                items={[
                  {
                    title: 'At the open home',
                    body: 'Buyers tap in their price opinion before they leave the kitchen. You walk away with 12 opinions instead of two scribbled phone numbers.',
                  },
                  {
                    title: 'On a private inspection',
                    body: 'Sit on the front step. Hand over the iPad. Capture the opinion before the conversation drifts to interest rates or commute times.',
                  },
                  {
                    title: 'During a vendor meeting',
                    body: 'Pull up the live dashboard right in front of the seller. Show them the data on the big screen. The whole conversation changes.',
                  },
                ]}
              />
            }
          />
        </div>
      </section>

      {/* Tech */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <TwoColumn
          reverse
          left={
            <div className="grid grid-cols-2 gap-4">
              <FeatureCard
                icon={Tablet}
                title="iPad-first"
                description="Designed pixel-perfectly for iPad. Also runs beautifully on iPad Mini and iPad Pro."
                accent="violet"
              />
              <FeatureCard
                icon={Zap}
                title="Native performance"
                description="Built natively, not a wrapped website. Instant taps, no flicker, no lag."
                accent="orange"
              />
              <FeatureCard
                icon={Sparkles}
                title="One log-in"
                description="Same account as your Premarket dashboard. Everything syncs automatically."
                accent="blue"
              />
              <FeatureCard
                icon={ShieldCheck}
                title="Enterprise security"
                description="Encrypted at rest, encrypted in transit, audited regularly. Built to your franchise's compliance standards."
                accent="emerald"
              />
            </div>
          }
          right={
            <div>
              <SectionHeading
                eyebrow="Built right"
                title="Native, fast, secure"
                subtitle="The Agent iPad app is built natively for iPadOS — every animation, every gesture, every transition feels right at home on Apple hardware."
              />
            </div>
          }
        />
      </section>

      <ClosingCTA
        title="Take Premarket into the field"
        subtitle="Free with every Premarket account. Available on the App Store for iPad and iPad Mini."
        primaryHref="/join"
        primaryLabel="Create free account"
        secondaryHref="/contact"
        secondaryLabel="Talk to us"
      />

      <PublicSiteFooter />
    </div>
  );
}
