'use client';

import {
  ShieldCheck,
  Eye,
  Camera,
  Home,
  MessageSquare,
  TrendingUp,
  Users,
  Calendar,
  CheckCircle2,
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
  fadeUp,
} from '../../components/marketing/MarketingShell';
import { motion } from 'framer-motion';

export default function HomeOwnersClient() {
  return (
    <div className={`bg-white text-slate-900 ${playfairDisplay.variable}`}>
      <PublicSiteNav />
      <MarketingHero
        eyebrow="For home owners"
        title={
          <>
            Find out what your home is{' '}
            <span className="bg-gradient-to-r from-[#e48900] to-[#c64500] bg-clip-text text-transparent">
              actually worth
            </span>
            — before you list it.
          </>
        }
        subtitle="Your local real estate agent represents your property on Premarket. No open homes. No upfront photography. No public listing risk. Just real buyers, real opinions, and real evidence — collected privately through your agent."
        primaryCta={{ href: '/contact', label: 'Find a Premarket agent' }}
        secondaryCta={{ href: '/premarket', label: 'How does it work?' }}
      />


      {/* Important — vendors don't self-list */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.4 }}
          className="rounded-3xl border border-orange-100 bg-gradient-to-br from-orange-50 via-amber-50/40 to-white p-8 sm:p-12 shadow-sm"
        >
          <p className="text-[11px] font-bold text-[#c64500] uppercase tracking-widest mb-3">
            Important — Premarket is agent-led
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight leading-tight">
            Your local agent represents your property — you can&apos;t list directly.
          </h2>
          <p className="mt-5 text-lg text-slate-700 leading-relaxed">
            Every Premarket property is represented by a licensed local agent. They know your suburb,
            your buyer pool, and the negotiation dynamics that protect your price. Your job is to
            choose a great agent — and then ask them to run the campaign through Premarket so you
            both work from the same buyer evidence.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href="/contact"
              className="inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-[#e48900] to-[#c64500] text-white text-sm font-semibold rounded-xl shadow-md shadow-orange-500/25 hover:shadow-lg transition-all"
            >
              Help me find an agent
            </a>
            <a
              href="/premarket"
              className="inline-flex items-center gap-2 px-5 py-3 bg-white border border-slate-200 text-slate-900 text-sm font-semibold rounded-xl hover:border-slate-300 transition-all"
            >
              Learn how Premarket works
            </a>
          </div>
        </motion.div>
      </section>

      {/* Why Premarket */}
      <section className="bg-slate-50 border-y border-slate-200/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
          <div className="text-center mb-16 max-w-3xl mx-auto">
            <SectionHeading
              align="center"
              eyebrow="Why home owners ask for it"
              title="The risk of going public is real"
              subtitle="A listing that sits too long. A price that gets corrected. A neighbour who finds out before you're ready. Premarket fixes all three."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              icon={ShieldCheck}
              title="Stay off the public portals"
              description="Your address doesn't appear on realestate.com.au or Domain. No nosy neighbours. No price-history leaving a trail."
              accent="orange"
            />
            <FeatureCard
              icon={Eye}
              title="See real buyer interest"
              description="Watch a live dashboard fill up with anonymous price opinions and registered interest from genuine buyers — before you commit to anything."
              accent="blue"
            />
            <FeatureCard
              icon={Camera}
              title="No expensive marketing first"
              description="Skip the photography, styling, brochures and portal upgrades until you're sure the price you have in mind is achievable."
              accent="emerald"
            />
            <FeatureCard
              icon={TrendingUp}
              title="Price with evidence, not opinion"
              description="Three agents will give you three different appraisals. A hundred buyers give you a number with a story behind it."
              accent="violet"
            />
            <FeatureCard
              icon={Users}
              title="Talk to serious buyers only"
              description="Buyer's agents and qualified buyers register interest privately. Skip the tyre-kickers. Skip the open homes."
              accent="rose"
            />
            <FeatureCard
              icon={Calendar}
              title="Move on your terms"
              description="If the data is strong, list with confidence. If it's not, pause without the embarrassment of withdrawing a campaign."
              accent="orange"
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <TwoColumn
          left={
            <div>
              <SectionHeading
                eyebrow="How it works"
                title="Five steps from curious to confident"
                subtitle="Your agent runs every step. You get a private dashboard, real numbers, and the option to keep going or stop at any time."
              />
            </div>
          }
          right={
            <BulletList
              items={[
                {
                  title: '1 · Choose your agent',
                  body: 'Pick a local agent you trust. They represent your property and run the entire campaign on your behalf — you can\'t list directly.',
                },
                {
                  title: '2 · Build the private campaign',
                  body: 'Your agent uploads basic property details, a photo or two, and a guide price. The whole thing takes a couple of minutes.',
                },
                {
                  title: '3 · Distribute privately',
                  body: 'The campaign goes to qualified buyers and buyer\'s agents only — never to the public portals. No open homes. No street signs.',
                },
                {
                  title: '4 · Buyers respond with evidence',
                  body: 'Real buyers submit anonymous price opinions and register interest. Your agent sees the live data populate in real time.',
                },
                {
                  title: '5 · Decide with confidence',
                  body: 'Sell off-market, run a confident on-market campaign with proven demand, or pause and revisit later. Your call.',
                },
              ]}
            />
          }
        />
      </section>

      {/* What you get */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24">
        <div className="text-center mb-12">
          <SectionHeading
            align="center"
            eyebrow="What you get"
            title="A private window into your local buyer pool"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            ['Median buyer opinion', 'A clear midpoint of what buyers think your home is worth right now.'],
            ['Price distribution', 'See exactly how the opinions are spread — tight cluster or wide range.'],
            ['Demand signals', 'Watch interest registrations stack up in real time.'],
            ['Engagement velocity', 'Find out if your home is gathering momentum — or sitting flat.'],
          ].map(([title, body]) => (
            <div
              key={title}
              className="rounded-2xl border border-slate-200 bg-white p-6 hover:border-orange-200 hover:shadow-sm transition-all"
            >
              <CheckCircle2 className="w-5 h-5 text-emerald-500 mb-3" />
              <p className="font-bold text-slate-900">{title}</p>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <ClosingCTA
        title="Talk to your agent about Premarket"
        subtitle="Already have an agent? Ask them about a Premarket campaign — it's free for you to discuss and they may already be set up. Don't have one yet? We can help you find one."
        primaryHref="/contact"
        primaryLabel="Find a Premarket agent"
        secondaryHref="/premarket"
        secondaryLabel="Read the explainer"
      />

      <PublicSiteFooter />
    </div>
  );
}
