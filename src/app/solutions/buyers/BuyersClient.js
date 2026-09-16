'use client';

import {
  Heart,
  Bell,
  TrendingUp,
  MapPin,
  Sparkles,
  MessageSquare,
  Lock,
  Clock,
  Eye,
  Activity,
} from 'lucide-react';
import PublicSiteNav from '../../components/public-site/PublicSiteNav';
import PublicSiteFooter from '../../components/public-site/PublicSiteFooter';
import {
  MarketingHero,
  SectionHeading,
  BreakoutStats,
  FeatureCard,
  ClosingCTA,
  TwoColumn,
  BulletList,
} from '../../components/marketing/MarketingShell';

export default function BuyersClient() {
  return (
    <div className="bg-white text-slate-900">
      <PublicSiteNav />
      <MarketingHero
        eyebrow="For buyers"
        title={
          <>
            See properties{' '}
            <span className="bg-gradient-to-r from-[#e48900] to-[#c64500] bg-clip-text text-transparent">
              before everyone else
            </span>
            .
          </>
        }
        subtitle="Save the homes you love. Share an honest price opinion. Get notified the moment new listings — including premarket exclusives — hit the platform."
        primaryCta={{ href: '/signup', label: 'Create free account' }}
        secondaryCta={{ href: '/listings', label: 'Browse properties' }}
      />

      {/* Stats */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 -mt-6 sm:-mt-10">
        <BreakoutStats
          stats={[
            {
              eyebrow: 'Free forever',
              value: '$0',
              label: 'Buyer accounts are free. Always. We make money from agents, not buyers.',
            },
            {
              eyebrow: 'Early access',
              value: 14,
              suffix: ' days',
              label: 'Median head-start premarket members get on private listings before they go public.',
            },
            {
              eyebrow: 'Watched areas',
              value: 10,
              label: 'Suburbs you can follow with live alerts, market scores and weekly digests.',
            },
          ]}
        />
      </section>

      {/* What you can do */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <SectionHeading
            align="center"
            eyebrow="What you can do"
            title="Built for buyers who actually mean business"
            subtitle="Premarket gives you tools that the big portals don't — because we're not in the advertising business. We're in the evidence business."
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <FeatureCard
            icon={Heart}
            title="Save and rate listings"
            description="Like properties, leave private notes, and rate them out of five so you don't lose track when you're seeing a dozen homes a week."
            accent="rose"
          />
          <FeatureCard
            icon={TrendingUp}
            title="Submit a price opinion"
            description="Tell the agent what you'd actually pay. It's anonymous, it's real evidence, and sometimes the seller drops their expectations because of it."
            accent="orange"
          />
          <FeatureCard
            icon={Bell}
            title="Smart alerts"
            description="Get notified the moment a new property matches your criteria — including premarket exclusives that aren't on realestate.com.au or Domain."
            accent="emerald"
          />
          <FeatureCard
            icon={Lock}
            title="Premarket exclusives"
            description="See homes that are being privately tested by their owners — sometimes weeks before the rest of the market hears about them."
            accent="violet"
          />
          <FeatureCard
            icon={MapPin}
            title="Watched areas"
            description="Follow up to 10 suburbs and get live PHI scores, weekly digests, and instant alerts when anything new appears."
            accent="blue"
          />
          <FeatureCard
            icon={Activity}
            title="Honest market insights"
            description="Real-time scores for buyer demand, supply pressure, and price realism in every suburb you care about."
            accent="orange"
          />
        </div>
      </section>

      {/* Premarket explainer for buyers */}
      <section className="bg-slate-50 border-y border-slate-200/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
          <TwoColumn
            left={
              <div>
                <SectionHeading
                  eyebrow="Premarket properties, explained"
                  title="The properties no one else is showing you"
                  subtitle="Some sellers test the water before they go public. Premarket is the only place buyers can see those homes — and the data they generate."
                />
                <p className="mt-6 text-base text-slate-600 leading-relaxed">
                  When a home owner asks their agent to run a private campaign, the property
                  appears on Premarket but stays off realestate.com.au and Domain. You get to
                  view it, share a price opinion, and register interest before there's any open
                  home, any signage, or any competing buyers reading the same portal feed.
                </p>
                <div className="mt-8 inline-flex items-center gap-2 px-4 py-2 bg-orange-50 border border-orange-200/70 rounded-full">
                  <Sparkles className="w-3.5 h-3.5 text-[#c64500]" />
                  <span className="text-xs font-bold text-[#c64500] uppercase tracking-wider">
                    Available to all signed-in buyers
                  </span>
                </div>
              </div>
            }
            right={
              <BulletList
                items={[
                  {
                    title: 'Premarket emails',
                    body: 'A dedicated email stream just for premarket exclusives in your watched areas. Never noisy. Always relevant.',
                  },
                  {
                    title: 'General listing emails',
                    body: 'Stay across every new on-market listing in your suburbs and price band — even the ones that don\'t hit the portals fast.',
                  },
                  {
                    title: 'Instant push for matches',
                    body: 'If we find a property that fits your buyer profile within the first hour of listing, we\'ll let you know straight away.',
                  },
                  {
                    title: 'Direct contact, no middlemen',
                    body: 'When you register strong interest, the listing agent sees your name and gets in touch — no leads sold to marketing companies.',
                  },
                ]}
              />
            }
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
                {
                  title: 'You get smarter',
                  body: 'Once you\'ve priced ten homes in your suburb, you\'ll have a sharper sense of value than 99% of the other buyers in your bracket.',
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
        title="Sign up free in under a minute"
        subtitle="Save listings, share price opinions, watch your suburbs, and be first to see premarket exclusives."
        primaryHref="/signup"
        primaryLabel="Create free account"
        secondaryHref="/listings"
        secondaryLabel="Browse properties"
      />

      <PublicSiteFooter />
    </div>
  );
}
