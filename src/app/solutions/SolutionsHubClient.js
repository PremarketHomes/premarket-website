'use client';

import { Home, Users, Briefcase, Building2, ArrowRight, ShieldCheck, Eye, TrendingUp } from 'lucide-react';
import PublicSiteNav from '../components/public-site/PublicSiteNav';
import PublicSiteFooter from '../components/public-site/PublicSiteFooter';
import {
  MarketingHero,
  SectionHeading,
  FeatureCard,
  ClosingCTA,
  PullQuote,
} from '../components/marketing/MarketingShell';

const solutions = [
  {
    icon: Home,
    title: 'Home Owners',
    description:
      'Sit down with your local agent and test the market privately first. See what real buyers think before you commit to open homes, photography, or marketing spend.',
    href: '/solutions/home-owners',
    accent: 'orange',
  },
  {
    icon: Users,
    title: 'Buyers',
    description:
      'Save the listings you love, share an honest price opinion, and get notified the moment new properties — including premarket exclusives — hit the platform.',
    href: '/solutions/buyers',
    accent: 'blue',
  },
  {
    icon: Briefcase,
    title: "Buyer's Agents",
    description:
      'Win your clients first-mover advantage. See premarket properties, register strong interest, and submit professional pricing before the rest of the market arrives.',
    href: '/solutions/buyers-agents',
    accent: 'violet',
  },
  {
    icon: Building2,
    title: 'Listing Agents',
    description:
      'Walk into every appraisal with live buyer evidence. Win more listings, defend your price guide, and convert more vendors — for $200 per campaign, no subscription.',
    href: '/solutions/agents',
    accent: 'emerald',
  },
];

export default function SolutionsHubClient() {
  return (
    <div className="bg-white text-slate-900">
      <PublicSiteNav />
      <MarketingHero
        eyebrow="Solutions"
        title={
          <>
            One platform.{' '}
            <span className="bg-gradient-to-r from-[#e48900] to-[#c64500] bg-clip-text text-transparent">
              Four audiences.
            </span>{' '}
            Real evidence.
          </>
        }
        subtitle="Premarket replaces guesswork with live buyer data — for the people selling, the people buying, and the agents who represent both sides of every transaction."
        primaryCta={{ href: '/signup', label: 'Create free account' }}
        secondaryCta={{ href: '/premarket', label: 'What is Premarket?' }}
      />


      {/* Four audiences */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <SectionHeading
            align="center"
            eyebrow="Choose your path"
            title="Built for every side of a property transaction"
            subtitle="Whether you own a home, you're hunting for one, or you're the agent steering the deal — Premarket meets you where you are."
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {solutions.map((s) => (
            <FeatureCard
              key={s.title}
              icon={s.icon}
              title={s.title}
              description={s.description}
              href={s.href}
              accent={s.accent}
            />
          ))}
        </div>
      </section>

      {/* Why it works */}
      <section className="bg-slate-50 border-y border-slate-200/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            <div className="lg:col-span-1">
              <SectionHeading
                eyebrow="Why it works"
                title="Three things every buyer journey needs"
                subtitle="Premarket is built around the simple, repeatable mechanics that actually drive a confident property decision."
              />
            </div>
            <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FeatureCard
                icon={Eye}
                title="Visibility before action"
                description="See genuine, anonymous buyer interest before you commit a single dollar of marketing — or before you commit to inspecting a home."
                accent="blue"
              />
              <FeatureCard
                icon={TrendingUp}
                title="Pricing built from people"
                description="Aggregated price opinions create a number with a story — not a black-box estimate. Real humans, real intent, real signals."
                accent="orange"
              />
              <FeatureCard
                icon={ShieldCheck}
                title="Privacy by default"
                description="Premarket campaigns can stay completely off the public portals. No stale-listing risk. No nosy neighbours."
                accent="emerald"
              />
              <FeatureCard
                icon={Users}
                title="Agent-led, buyer-powered"
                description="Listing agents, buyer's agents and home buyers all contribute to the same evidence pool — and everyone gets to act on it sooner."
                accent="violet"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Pull quote */}
      <section className="py-24 sm:py-32">
        <PullQuote
          quote="A home is worth what a buyer would pay for it — not what the house across the street sold for two months ago."
          author="The Premarket thesis"
        />
      </section>

      <ClosingCTA
        title="Pick the path that fits you"
        subtitle="Buyers join free in under a minute. Home owners can ask their agent. Agents can start their first campaign today."
        primaryHref="/signup"
        primaryLabel="Create free account"
        secondaryHref="/contact"
        secondaryLabel="Talk to us"
      />

      <PublicSiteFooter />
    </div>
  );
}
