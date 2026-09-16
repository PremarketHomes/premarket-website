'use client';

import {
  TrendingUp,
  Lock,
  Users,
  MessageSquare,
  Scale,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { motion } from 'framer-motion';
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
  fadeUp,
  stagger,
} from '../../components/marketing/MarketingShell';

export default function PriceOpinionsClient() {
  return (
    <div className={`bg-white text-slate-900 ${playfairDisplay.variable}`}>
      <PublicSiteNav />
      <MarketingHero
        eyebrow="Price Opinions"
        title={
          <>
            The most{' '}
            <span className="bg-gradient-to-r from-[#e48900] to-[#c64500] bg-clip-text text-transparent">
              polite negotiation tool
            </span>{' '}
            in real estate.
          </>
        }
        subtitle="Real buyers tell agents what they'd pay — anonymously, honestly, and without the awkwardness of an offer. Sometimes sellers drop their expectations because of it."
        primaryCta={{ href: '/join', label: 'Start a campaign' }}
        secondaryCta={{ href: '/features', label: 'All features' }}
      />


      {/* What it is */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <TwoColumn
          left={
            <div>
              <SectionHeading
                eyebrow="What is a price opinion?"
                title="A number with a story behind it"
                subtitle="A price opinion is a single number — what a real buyer says they'd genuinely pay for the property. It's anonymous, it's submitted in seconds, and it carries more weight than a thousand portal clicks."
              />
              <p className="mt-6 text-base text-slate-600 leading-relaxed">
                Buyers can submit a price opinion on any listing. Buyer's agents can submit on
                behalf of clients. The opinions stack up over time and form a distribution — a
                visual, honest picture of where the market sits.
              </p>
            </div>
          }
          right={
            <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-orange-50 via-amber-50/40 to-white p-8 shadow-sm">
              <p className="text-[11px] font-bold text-[#c64500] uppercase tracking-widest mb-3">
                Example campaign
              </p>
              <p className="text-sm text-slate-500">42 Hill St, Newtown NSW</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">Guide $1.85M</p>
              <div className="mt-6 space-y-3">
                {[
                  ['Median opinion', '$1.74M', 'amber'],
                  ['Lowest', '$1.62M', 'rose'],
                  ['Highest', '$1.92M', 'emerald'],
                  ['Opinions submitted', '23', 'blue'],
                ].map(([k, v, tint]) => {
                  const tintMap = {
                    amber: 'text-amber-600 bg-amber-50',
                    rose: 'text-rose-600 bg-rose-50',
                    emerald: 'text-emerald-600 bg-emerald-50',
                    blue: 'text-blue-600 bg-blue-50',
                  };
                  return (
                    <div key={k} className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-4 py-3">
                      <span className="text-sm text-slate-600">{k}</span>
                      <span className={`text-sm font-bold px-2.5 py-1 rounded-md ${tintMap[tint]}`}>{v}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          }
        />
      </section>

      {/* Why it works */}
      <section className="bg-slate-50 border-y border-slate-200/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
          <div className="text-center mb-16 max-w-3xl mx-auto">
            <SectionHeading
              align="center"
              eyebrow="Why it works"
              title="Anonymous evidence breaks every deadlock"
              subtitle="Vendors trust their own eyes. Buyers trust the platform's privacy. Agents trust the data. Everyone wins."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              icon={Lock}
              title="Anonymous by design"
              description="Buyers can submit without revealing their identity to the vendor. We separate the opinion from the person on purpose."
              accent="orange"
            />
            <FeatureCard
              icon={Users}
              title="Real buyers only"
              description="Every opinion comes from a verified Premarket account. We strip noise, duplicates, and bots before the data is shown."
              accent="blue"
            />
            <FeatureCard
              icon={Scale}
              title="Aggregated, not exposed"
              description="Vendors see distributions — never individual numbers in isolation. The signal is the cluster, not the outlier."
              accent="emerald"
            />
            <FeatureCard
              icon={MessageSquare}
              title="Optional context"
              description="Buyers can attach a one-line reason for their opinion. Sometimes that line is more valuable than the price itself."
              accent="violet"
            />
            <FeatureCard
              icon={ShieldCheck}
              title="Vendor-protected"
              description="Buyers can't see what other buyers have submitted. There's no anchoring, no copying, no manipulation."
              accent="rose"
            />
            <FeatureCard
              icon={Sparkles}
              title="Always current"
              description="Every new opinion is already there the next time the report is opened. Agents and vendors see the picture sharpen as the data fills in."
              accent="orange"
            />
          </div>
        </div>
      </section>

      {/* For each audience */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <SectionHeading
            align="center"
            eyebrow="What it does for each side"
            title="One feature. Three different superpowers."
          />
        </div>

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-5"
        >
          {[
            {
              title: 'For buyers',
              points: [
                'Politely move the seller without giving away your name',
                'Build credibility with the listing agent',
                'Become a sharper valuer with every opinion you submit',
              ],
              accent: 'from-blue-500 to-blue-600',
              border: 'border-blue-100',
            },
            {
              title: "For buyer's agents",
              points: [
                'Translate your client brief into a real market signal',
                'Lock in priority with the listing agent',
                'Demonstrate expertise to your client in writing',
              ],
              accent: 'from-violet-500 to-purple-600',
              border: 'border-violet-100',
            },
            {
              title: 'For listing agents & vendors',
              points: [
                'Replace appraisal arguments with hard evidence',
                'Spot overpriced campaigns before they go stale',
                'Walk into vendor meetings with numbers, not opinions',
              ],
              accent: 'from-[#e48900] to-[#c64500]',
              border: 'border-orange-100',
            },
          ].map((col) => (
            <motion.div
              key={col.title}
              variants={fadeUp}
              className={`rounded-3xl border ${col.border} bg-white p-8 shadow-sm hover:shadow-xl hover:shadow-slate-900/[0.05] transition-shadow`}
            >
              <div className={`inline-flex items-center gap-1.5 mb-5 px-3 py-1 rounded-full text-white text-[11px] font-bold uppercase tracking-wider bg-gradient-to-r ${col.accent}`}>
                {col.title}
              </div>
              <ul className="space-y-3">
                {col.points.map((p, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-slate-700 leading-relaxed">{p}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </motion.div>
      </section>

      <ClosingCTA
        title="Give your next seller conversation real evidence"
        subtitle="$200 per campaign, no subscription. Anonymous buyer opinions your vendor can't argue with."
        primaryHref="/join"
        primaryLabel="Start a campaign"
        secondaryHref="/contact"
        secondaryLabel="Talk to us"
      />

      <PublicSiteFooter />
    </div>
  );
}
