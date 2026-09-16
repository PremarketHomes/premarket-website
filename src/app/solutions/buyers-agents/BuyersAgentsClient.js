'use client';

import { Handshake, TrendingUp, Users, ShieldCheck } from 'lucide-react';
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

export default function BuyersAgentsClient() {
  return (
    <div className={`bg-white text-slate-900 ${playfairDisplay.variable}`}>
      <PublicSiteNav />
      <MarketingHero
        eyebrow="For buyer's agents"
        title={
          <>
            Submit informed opinions{' '}
            <span className="bg-gradient-to-r from-[#e48900] to-[#c64500] bg-clip-text text-transparent">
              on behalf of your clients
            </span>
            .
          </>
        }
        subtitle="When a listing agent shares a Premarket property with you, you can submit an anonymous price opinion or register genuine interest — the same tools every buyer has, no special account required."
        primaryCta={{ href: '/contact', label: 'Talk to us' }}
        secondaryCta={{ href: '/signup', label: 'Create a buyer account' }}
      />

      {/* What's real today */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <SectionHeading
            align="center"
            eyebrow="How it works"
            title="The same tools every buyer has"
            subtitle="There's no separate buyer's-agent product today — you use Premarket exactly as any buyer would, informed by your professional judgement."
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <FeatureCard
            icon={TrendingUp}
            title="Submit a price opinion"
            description="Translate your read of the property into a real, anonymous price opinion the listing agent sees directly."
            accent="orange"
          />
          <FeatureCard
            icon={Handshake}
            title="Register genuine interest"
            description="When you or your client are serious, register interest and the listing agent gets your contact details directly."
            accent="emerald"
          />
          <FeatureCard
            icon={Users}
            title="Off-portal access"
            description="Premarket campaigns are shared privately by the listing agent — not published to the public portals unless the vendor chooses to."
            accent="blue"
          />
          <FeatureCard
            icon={ShieldCheck}
            title="Anonymous until you choose"
            description="Your price opinion stays anonymous unless you also register interest — the same privacy every buyer gets."
            accent="violet"
          />
        </div>
      </section>

      {/* Workflow */}
      <section className="bg-slate-50 border-y border-slate-200/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
          <TwoColumn
            left={
              <div>
                <SectionHeading
                  eyebrow="Workflow"
                  title="How it actually works today"
                  subtitle="A simple, direct process — no platform-side matching or scheduling involved."
                />
              </div>
            }
            right={
              <BulletList
                accent="violet"
                items={[
                  {
                    title: '1 · A listing agent shares a property with you',
                    body: 'The same way they\'d share it with any buyer — directly, by link.',
                  },
                  {
                    title: '2 · Open the property experience',
                    body: 'No account needed to look around or see what\'s there.',
                  },
                  {
                    title: '3 · Submit a price opinion or register interest',
                    body: 'Anonymous by default. Register interest when you want the listing agent to have your (or your client\'s) details.',
                  },
                ]}
              />
            }
          />
        </div>
      </section>

      <ClosingCTA
        title="Same tools, professional judgement"
        subtitle="Anonymous price opinions and registered interest — the same tools every buyer has."
        primaryHref="/contact"
        primaryLabel="Talk to us"
        secondaryHref="/signup"
        secondaryLabel="Create a buyer account"
      />

      <PublicSiteFooter />
    </div>
  );
}
