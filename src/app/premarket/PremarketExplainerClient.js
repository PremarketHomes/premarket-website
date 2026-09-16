'use client';

import {
  Eye,
  Camera,
  Home,
  TrendingUp,
  Users,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import PublicSiteNav from '../components/public-site/PublicSiteNav';
import { playfairDisplay } from '../components/property-page/fonts';
import PublicSiteFooter from '../components/public-site/PublicSiteFooter';
import {
  MarketingHero,
  SectionHeading,
  FeatureCard,
  ClosingCTA,
  PullQuote,
  fadeUp,
  stagger,
} from '../components/marketing/MarketingShell';

const FAQ = [
  {
    q: 'Is Premarket free for buyers?',
    a: "Yes — completely free, forever. We make money from real estate agents who run campaigns on the platform. Buyers and buyer's agents never pay a cent.",
  },
  {
    q: 'Can I list my own home as a vendor?',
    a: "Premarket is agent-led on purpose. The right path is to ask your local real estate agent about a Premarket campaign — they'll run the campaign for you. If you don't have an agent yet, our team can help you find one in your area.",
  },
  {
    q: 'Will my home appear on realestate.com.au or Domain?',
    a: "Only if you choose. Premarket campaigns can stay completely private — visible only to qualified buyers and buyer's agents on the platform. You decide when (and if) you go public.",
  },
  {
    q: 'How much does it cost an agent to list a property?',
    a: "The campaign fee is $200 AUD, vendor-paid, per listing — not paid by the agent. There's no subscription, no monthly minimum, and buyers and buyer's agents are completely free.",
  },
  {
    q: "What's a 'price opinion'?",
    a: "A price opinion is a single number — what a real buyer says they'd genuinely pay for the property. It's anonymous, takes seconds to submit, and is aggregated with other opinions to form a clear, evidence-based picture of where the market sits.",
  },
  {
    q: 'Do I need professional photography?',
    a: "That's the agent's call. Premarket is about testing buyer response and collecting market feedback — before or during whatever wider marketing campaign you run. Plenty of agents run a Premarket campaign alongside full professional photography and styling.",
  },
  {
    q: 'How do buyers find premarket properties?',
    a: "They don't browse for them — an agent sends a direct link, usually by email, SMS or through their own database. Buyers open the property, share a price opinion or register interest, and don't need to create an account to do either.",
  },
  {
    q: 'Is Premarket available across Australia?',
    a: 'Yes. Premarket runs nationally, with active campaigns in every state and territory.',
  },
];

function FAQItem({ item, index }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div variants={fadeUp} className="border-b border-slate-200">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left py-6 group"
      >
        <span className="text-lg font-bold text-slate-900 pr-8 group-hover:text-[#c64500] transition-colors">
          {item.q}
        </span>
        <span
          className={`w-8 h-8 rounded-full bg-orange-50 flex items-center justify-center text-[#c64500] flex-shrink-0 transition-transform ${
            open ? 'rotate-45' : ''
          }`}
        >
          <span className="text-xl leading-none">+</span>
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="pb-6 text-base text-slate-600 leading-relaxed">{item.a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function PremarketExplainerClient() {
  return (
    <div className={`bg-white text-slate-900 ${playfairDisplay.variable}`}>
      <PublicSiteNav />
      <MarketingHero
        eyebrow="What is Premarket?"
        title={
          <>
            Real estate, decided by{' '}
            <span className="bg-gradient-to-r from-[#e48900] to-[#c64500] bg-clip-text text-transparent">
              real evidence
            </span>
            .
          </>
        }
        subtitle="A home is worth what a buyer would pay for it — not what the house across the street sold for two months ago. Premarket is how Australian property gets priced honestly."
        primaryCta={{ href: '/join', label: 'Start a campaign' }}
        secondaryCta={{ href: '/contact', label: 'Talk to us' }}
      />


      {/* Big idea */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-24 sm:py-32 text-center">
        <PullQuote
          quote="Three agents will give you three different appraisals. A hundred buyers give you a number with a story behind it."
          author="The Premarket thesis"
        />
      </section>

      {/* The old way vs the new way */}
      <section className="bg-slate-50 border-y border-slate-200/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
          <div className="text-center mb-16 max-w-3xl mx-auto">
            <SectionHeading
              align="center"
              eyebrow="Old way vs new way"
              title="Selling property is broken — and everyone knows it"
              subtitle="The old playbook hasn't been updated in twenty years. Premarket replaces it with something honest."
            />
          </div>

          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-6"
          >
            <motion.div
              variants={fadeUp}
              className="rounded-3xl border border-rose-100 bg-gradient-to-br from-rose-50/60 to-white p-8 sm:p-10"
            >
              <p className="text-[11px] font-bold text-rose-600 uppercase tracking-widest mb-3">The old way</p>
              <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Pay first. Hope later.</h3>
              <ul className="mt-6 space-y-4">
                {[
                  'Three agents argue about a price using last quarter\'s settlements.',
                  'You commit to expensive photography, styling and marketing.',
                  'You list publicly with a price you privately don\'t believe in.',
                  'Open homes turn into circus performances for tyre-kickers.',
                  'The price gets corrected. The listing goes stale.',
                  'You sell — eventually — for less than you should have.',
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <XCircle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
                    <span className="text-base text-slate-600">{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div
              variants={fadeUp}
              className="rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-50/60 to-white p-8 sm:p-10"
            >
              <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-widest mb-3">The Premarket way</p>
              <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Test first. Sell second.</h3>
              <ul className="mt-6 space-y-4">
                {[
                  'Your agent sets up a private campaign in two minutes.',
                  'Test buyer response before or during your wider marketing campaign.',
                  'Real buyers submit anonymous price opinions and register interest.',
                  'A live report shows you exactly where the market sits.',
                  'You list with confidence — or sell off-market entirely.',
                  'The price you choose is the price the data already proved.',
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span className="text-base text-slate-600">{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* No open homes / No photography */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <SectionHeading
            align="center"
            eyebrow="Why it's different"
            title="Test the market before you commit to it"
            subtitle="Open homes are optional with Premarket — and you can test buyer response before or during whatever wider campaign you run."
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <FeatureCard
            icon={Home}
            title="No open homes"
            description="No strangers walking through your kitchen on a Saturday. No competing buyers anchoring against each other in your bedroom. Private inspections only — by appointment, with serious buyers."
            accent="orange"
          />
          <FeatureCard
            icon={Camera}
            title="Test before you commit"
            description="Gather real buyer evidence before or during a wider marketing campaign. Many agents run Premarket alongside full professional photography and marketing — it's not a substitute for either."
            accent="blue"
          />
          <FeatureCard
            icon={ShieldCheck}
            title="No public footprint"
            description="Your home doesn't appear on the public portals unless you choose. No nosy neighbours. No price-history damage if you change your mind."
            accent="emerald"
          />
        </div>
      </section>

      {/* Who it's for */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <SectionHeading
            align="center"
            eyebrow="Who it's for"
            title="Built for everyone in a property transaction"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <FeatureCard
            icon={Home}
            title="Home owners"
            description="Test the market privately before committing to anything. Talk to your local agent about a Premarket campaign."
            href="/solutions/home-owners"
            accent="orange"
          />
          <FeatureCard
            icon={Users}
            title="Buyers"
            description="Open the property your agent sends you, share a price opinion, and register interest — no account needed."
            href="/solutions/buyers"
            accent="blue"
          />
          <FeatureCard
            icon={TrendingUp}
            title="Buyer's agents"
            description="When a listing agent shares a property with you, submit a price opinion or register interest on behalf of your client — the same tools every buyer has."
            href="/solutions/buyers-agents"
            accent="violet"
          />
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-slate-50 border-y border-slate-200/70">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
          <SectionHeading
            align="center"
            eyebrow="FAQ"
            title="The questions everyone asks first"
          />
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.1 }}
            className="mt-12"
          >
            {FAQ.map((item, i) => (
              <FAQItem key={i} item={item} index={i} />
            ))}
          </motion.div>
        </div>
      </section>

      <ClosingCTA
        title="See what real evidence looks like"
        subtitle="Agents can start their first campaign today. Home owners can ask their agent. Buyers open the link their agent sends them."
        primaryHref="/join"
        primaryLabel="Start a campaign"
        secondaryHref="/contact"
        secondaryLabel="Talk to us"
      />

      <PublicSiteFooter />
    </div>
  );
}
