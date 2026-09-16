'use client';

import { FileBarChart, Activity, BellRing, TrendingUp, Tablet, Sparkles } from 'lucide-react';
import PublicSiteNav from '../components/public-site/PublicSiteNav';
import PublicSiteFooter from '../components/public-site/PublicSiteFooter';
import {
  MarketingHero,
  SectionHeading,
  FeatureCard,
  ClosingCTA,
} from '../components/marketing/MarketingShell';

const features = [
  {
    icon: FileBarChart,
    title: 'Reports',
    description:
      'Live vendor reports built from real buyer evidence. Auto-updating, beautifully formatted, and ready to share the moment a buyer engages.',
    href: '/features/reports',
    accent: 'orange',
  },
  {
    icon: Activity,
    title: 'Data Metrics',
    description:
      'Eight live PHI scores per suburb — buyer demand, seller motivation, price realism, supply pressure and more.',
    href: '/features/data-metrics',
    accent: 'blue',
  },
  {
    icon: BellRing,
    title: 'Reminders',
    description:
      'Smart, automated nudges that re-engage buyers, follow up on viewings, and keep every campaign moving forward.',
    href: '/features/reminders',
    accent: 'emerald',
  },
  {
    icon: TrendingUp,
    title: 'Price Opinions',
    description:
      'Anonymous buyer pricing aggregated into a clear, trustworthy market signal. The most polite negotiation tool in real estate.',
    href: '/features/price-opinions',
    accent: 'rose',
  },
  {
    icon: Tablet,
    title: 'Agent iPad',
    description:
      'A purpose-built iPad app for capturing buyer feedback in the field. Take it to the open home. Take it to the appraisal. Take it everywhere.',
    href: '/features/agent-ipad',
    accent: 'violet',
  },
];

export default function FeaturesHubClient() {
  return (
    <div className="bg-white text-slate-900">
      <PublicSiteNav />
      <MarketingHero
        eyebrow="Features"
        title={
          <>
            A purpose-built{' '}
            <span className="bg-gradient-to-r from-[#e48900] to-[#c64500] bg-clip-text text-transparent">
              data layer
            </span>{' '}
            for real estate.
          </>
        }
        subtitle="Premarket isn't a CRM. It isn't a portal. It's an evidence engine that runs alongside everything you already use."
        primaryCta={{ href: '/signup', label: 'Get started free' }}
        secondaryCta={{ href: '/premarket', label: 'What is Premarket?' }}
      />


      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <SectionHeading
            align="center"
            eyebrow="Five products. One platform."
            title="Everything Premarket offers, in one place"
            subtitle="Each feature is good on its own. Used together, they create something the rest of the industry simply can't replicate — a forward-looking view of buyer intent in your suburb, right now."
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <FeatureCard
              key={f.title}
              icon={f.icon}
              title={f.title}
              description={f.description}
              href={f.href}
              accent={f.accent}
            />
          ))}
        </div>
      </section>

      <ClosingCTA
        title="See every feature in action"
        subtitle="Spin up a free account in two minutes. No credit card. No commitment. Just real evidence."
        primaryHref="/signup"
        primaryLabel="Create free account"
        secondaryHref="/contact"
        secondaryLabel="Talk to us"
      />

      <PublicSiteFooter />
    </div>
  );
}
