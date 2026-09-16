'use client';

import { Heart, TrendingUp, HandHeart, BarChart3 } from 'lucide-react';
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

export default function BuyersClient() {
  return (
    <div className={`bg-white text-slate-900 ${playfairDisplay.variable}`}>
      <PublicSiteNav />
      <MarketingHero
        eyebrow="For buyers"
        title={
          <>
            Your agent{' '}
            <span className="bg-gradient-to-r from-[#e48900] to-[#c64500] bg-clip-text text-transparent">
              sends the link
            </span>
            . You take it from there.
          </>
        }
        subtitle="When an agent shares a property with you through Premarket, you can look around, share what you'd pay, and register interest — no account required."
        primaryCta={{ href: '/signup', label: 'Create free account' }}
      />

      {/* What you can do */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <SectionHeading
            align="center"
            eyebrow="What you can do"
            title="Simple, honest, and never obligated"
            subtitle="Premarket doesn't ask you to browse a portal. It's how you respond to a property your agent already sent you."
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <FeatureCard
            icon={TrendingUp}
            title="Submit a price opinion"
            description="Tell the agent what you'd actually pay. It's anonymous, it's real evidence, and no account is needed to do it."
            accent="orange"
          />
          <FeatureCard
            icon={HandHeart}
            title="Register genuine interest"
            description="If you're serious, let the agent know. They'll get your details and follow up directly — no leads sold on to anyone else."
            accent="rose"
          />
          <FeatureCard
            icon={Heart}
            title="Keep track of what you're sent"
            description="Create a free account and every property an agent shares with you stays saved, with your own notes, so nothing gets lost."
            accent="blue"
          />
          <FeatureCard
            icon={BarChart3}
            title="See your own history"
            description="Once you've shared a few opinions, your account shows you how your view of value compares over time."
            accent="emerald"
          />
        </div>
      </section>

      {/* Why share a price opinion */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <TwoColumn
          reverse
          left={
            <BulletList
              accent="orange"
              items={[
                {
                  title: 'You move the market — gently',
                  body: 'A cluster of price opinions below the asking price often nudges sellers to reset expectations. It\'s the most polite negotiation tool ever invented.',
                },
                {
                  title: 'You build credibility',
                  body: 'Agents see thoughtful, honest opinions and remember you. When the right home comes up, the agent calls you first.',
                },
                {
                  title: 'You stay anonymous',
                  body: 'Your name isn\'t attached to your opinion unless you also register interest. No awkward conversations.',
                },
              ]}
            />
          }
          right={
            <div>
              <SectionHeading
                eyebrow="Why share a price opinion?"
                title="It changes the whole conversation"
                subtitle="Price opinions aren't bids. They're real, anonymous, evidence — and they're how you actually shape the deal in your favour."
              />
            </div>
          }
        />
      </section>

      <ClosingCTA
        title="Ready when your agent sends you something"
        subtitle="Create a free account to keep track of what you're sent, or just open the link when it arrives — no account required for that."
        primaryHref="/signup"
        primaryLabel="Create free account"
        secondaryHref="/contact"
        secondaryLabel="Talk to us"
      />

      <PublicSiteFooter />
    </div>
  );
}
