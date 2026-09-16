'use client';

import {
  Activity,
  Flame,
  Users,
  Scale,
  Gauge,
  Zap,
  Award,
  TrendingUp,
  ArrowDownUp,
} from 'lucide-react';
import { motion } from 'framer-motion';
import PublicSiteNav from '../../components/public-site/PublicSiteNav';
import { playfairDisplay } from '../../components/property-page/fonts';
import PublicSiteFooter from '../../components/public-site/PublicSiteFooter';
import {
  MarketingHero,
  SectionHeading,
  ClosingCTA,
  fadeUp,
  stagger,
} from '../../components/marketing/MarketingShell';

const PHI_METRICS = [
  {
    code: 'MHI',
    name: 'Market Heat Index',
    short: 'How hot the market is overall',
    long: 'A composite headline number — combines buyer demand, seller motivation, engagement velocity and price validity into a single 0-100 reading per suburb.',
    icon: Flame,
    accent: '#e48900',
  },
  {
    code: 'BDI',
    name: 'Buyer Demand Index',
    short: 'Real demand from real buyers',
    long: 'Aggregates price opinions, registrations of interest, likes and engagement to quantify how much buyer attention a suburb is attracting right now.',
    icon: Users,
    accent: '#3b82f6',
  },
  {
    code: 'SMI',
    name: 'Seller Motivation Index',
    short: 'How eager sellers are to transact',
    long: 'Measures the urgency of supply: how quickly listings are going to market, price reductions, and the proportion of vendors actively engaging with buyer feedback.',
    icon: Activity,
    accent: '#10b981',
  },
  {
    code: 'PVI',
    name: 'Price Validity Index',
    short: 'Are prices set correctly?',
    long: 'Compares the median buyer opinion against the listing price to spot overpriced and underpriced stock. Anything more than ~7% off triggers a flag.',
    icon: Gauge,
    accent: '#8b5cf6',
  },
  {
    code: 'EVS',
    name: 'Engagement Velocity Score',
    short: 'How fast properties get traction',
    long: 'Tracks the time between a property going live and the first wave of buyer engagement. High velocity = a tight market with hungry buyers.',
    icon: Zap,
    accent: '#f59e0b',
  },
  {
    code: 'BQI',
    name: 'Buyer Quality Index',
    short: 'Are the buyers serious?',
    long: 'Separates browsers from financially-ready buyers. A high BQI means the suburb is attracting buyers who can actually transact, not window-shoppers.',
    icon: Award,
    accent: '#06b6d4',
  },
  {
    code: 'FPI',
    name: 'Forward Pipeline Index',
    short: 'What\'s about to come to market',
    long: 'Looks at premarket campaigns, scheduled go-to-market dates and vendor inquiries to forecast supply pressure 30-90 days out.',
    icon: TrendingUp,
    accent: '#ec4899',
  },
  {
    code: 'SDB',
    name: 'Supply-Demand Balance',
    short: 'Is it a buyer\'s or seller\'s market?',
    long: 'A simple ratio centred on 50. Above 50 means a seller\'s market with buyers competing for stock. Below 50 means buyers have the leverage.',
    icon: ArrowDownUp,
    accent: '#14b8a6',
  },
];

export default function DataMetricsClient() {
  return (
    <div className={`bg-white text-slate-900 ${playfairDisplay.variable}`}>
      <PublicSiteNav />
      <MarketingHero
        eyebrow="Data Metrics"
        title={
          <>
            A{' '}
            <span className="bg-gradient-to-r from-[#e48900] to-[#c64500] bg-clip-text text-transparent">
              Bloomberg terminal
            </span>{' '}
            for property.
          </>
        }
        subtitle="Eight live indicators tell you what every suburb in Australia is doing right now — built from real buyer evidence, not historical settlements."
        primaryCta={{ href: '/join', label: 'Explore the data' }}
        secondaryCta={{ href: '/features', label: 'All features' }}
      />


      {/* Eight metrics */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <SectionHeading
            align="center"
            eyebrow="The eight PHI metrics"
            title="What every score actually means"
            subtitle="Each metric is a 0-100 reading. Higher is hotter. Each is explained in plain English so you can talk about them confidently with vendors and clients."
          />
        </div>

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.1 }}
          className="grid grid-cols-1 md:grid-cols-2 gap-5"
        >
          {PHI_METRICS.map((m) => {
            const Icon = m.icon;
            return (
              <motion.div
                key={m.code}
                variants={fadeUp}
                className="group rounded-3xl border border-slate-200 bg-white p-7 sm:p-8 hover:border-slate-300 hover:shadow-xl hover:shadow-slate-900/[0.05] transition-all"
              >
                <div className="flex items-start gap-5">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `linear-gradient(135deg, ${m.accent}22, ${m.accent}0d)` }}
                  >
                    <Icon className="w-6 h-6" style={{ color: m.accent }} strokeWidth={2.25} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <h3 className="text-2xl font-bold text-slate-900 tracking-tight">{m.name}</h3>
                      <span
                        className="font-mono text-xs font-bold tracking-wider px-2 py-0.5 rounded-md"
                        style={{ color: m.accent, background: `${m.accent}15` }}
                      >
                        {m.code}
                      </span>
                    </div>
                    <p className="mt-1 text-base font-semibold text-slate-700">{m.short}</p>
                    <p className="mt-3 text-sm text-slate-600 leading-relaxed">{m.long}</p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </section>

      {/* Why it's different */}
      <section className="bg-slate-50 border-y border-slate-200/70 py-24 sm:py-32">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <SectionHeading
            align="center"
            eyebrow="Why PHI is different"
            title="Forward-looking, not backward-looking"
            subtitle="Most real-estate data tells you what already happened. PHI tells you what is happening — and what's about to."
          />

          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-px bg-slate-200 rounded-3xl overflow-hidden border border-slate-200"
          >
            {[
              ['CoreLogic & co.', 'Backward-looking', 'Built on settled sales — by the time the data updates, the market has already moved.'],
              ['Portal heatmaps', 'Surface signal only', 'Counts of clicks and saves on a public portal — useful, but heavily diluted by tyre-kickers.'],
              ['Premarket PHI', 'Live and intent-based', 'Built from real, attributed buyer engagement — including price opinions buyers actually committed to.'],
            ].map(([title, badge, body], i) => (
              <motion.div key={i} variants={fadeUp} className="bg-white p-8">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">{badge}</p>
                <h3 className="text-xl font-bold text-slate-900 tracking-tight">{title}</h3>
                <p className="mt-3 text-sm text-slate-600 leading-relaxed">{body}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <ClosingCTA
        title="See PHI scores for your suburb"
        subtitle="Every Premarket agent gets full access to the live data layer — for every Australian suburb."
        primaryHref="/join"
        primaryLabel="Create free account"
        secondaryHref="/features"
        secondaryLabel="Explore all features"
      />

      <PublicSiteFooter />
    </div>
  );
}
