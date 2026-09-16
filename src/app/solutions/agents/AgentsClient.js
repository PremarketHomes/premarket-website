'use client';

import {
  Trophy,
  FileText,
  Eye,
  Users,
  ShieldCheck,
  Sparkles,
  ClipboardCheck,
  Activity,
  Zap,
  TrendingUp,
} from 'lucide-react';
import PublicSiteNav from '../../components/public-site/PublicSiteNav';
import PublicSiteFooter from '../../components/public-site/PublicSiteFooter';
import {
  MarketingHero,
  SectionHeading,
  FeatureCard,
  ClosingCTA,
  TwoColumn,
  BulletList,
} from '../../components/marketing/MarketingShell';

export default function AgentsClient() {
  return (
    <div className="bg-white text-slate-900">
      <PublicSiteNav />
      <MarketingHero
        eyebrow="For listing agents"
        title={
          <>
            Win more listings with{' '}
            <span className="bg-gradient-to-r from-[#e48900] to-[#c64500] bg-clip-text text-transparent">
              real buyer evidence
            </span>
            .
          </>
        }
        subtitle="Walk into every appraisal with a live vendor report in hand. Test the market privately, defend your price guide, and convert more appraisals into signed listings."
        primaryCta={{ href: '/join', label: 'Start a campaign' }}
        secondaryCta={{ href: '/contact', label: 'Talk to our team' }}
      />


      {/* Why agents win with Premarket */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <SectionHeading
            align="center"
            eyebrow="Why it works"
            title="The unfair advantage in every appraisal you walk into"
            subtitle="Vendors don't trust comparable sales. They trust live buyers. Premarket hands you the only thing more persuasive than your experience — the market itself."
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <FeatureCard
            icon={Trophy}
            title="Win the listing presentation"
            description="Show up with a live vendor report instead of a folder of comparables. Real buyers, real opinions, real price ranges — printed on the day."
            accent="orange"
          />
          <FeatureCard
            icon={FileText}
            title="Defend your price guide"
            description="When the market gives you a number, you don't have to. Premarket replaces awkward conversations with evidence the vendor can read for themselves."
            accent="violet"
          />
          <FeatureCard
            icon={Eye}
            title="Test the market privately"
            description="Run a fully off-portal premarket campaign for nervous vendors. No StreetView pin. No Domain listing. No risk of looking stale."
            accent="blue"
          />
          <FeatureCard
            icon={Users}
            title="Bring real buyers to launch day"
            description="By the time you go on-market, you already have a queue of qualified, named, opinion-submitting buyers. Cold launches are over."
            accent="emerald"
          />
          <FeatureCard
            icon={Activity}
            title="Live PHI for every suburb"
            description="Eight live indicators tell you when to push for an auction, when to go private treaty, and when to wait. Your appraisal isn't a guess."
            accent="rose"
          />
          <FeatureCard
            icon={ClipboardCheck}
            title="Vendor reports on demand"
            description="Generate a beautifully designed vendor report at any point in the campaign. PDF or in-app. Branded to your agency."
            accent="orange"
          />
        </div>
      </section>

      {/* How a campaign actually runs */}
      <section className="bg-slate-50 border-y border-slate-200/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
          <TwoColumn
            left={
              <div>
                <SectionHeading
                  eyebrow="How it works"
                  title="A campaign, end-to-end"
                  subtitle="From the appraisal handshake to the listing agreement signature, Premarket fits inside the way you already run a deal."
                />
              </div>
            }
            right={
              <BulletList
                accent="orange"
                items={[
                  {
                    title: '1 · Set up the property',
                    body: 'Enter the address, photos, and a short brief. Two minutes. The campaign goes live the moment you save it.',
                  },
                  {
                    title: '2 · Collect price opinions privately',
                    body: 'Real buyers in the area submit anonymous, honest price opinions. No marketing spend. No open homes. No portal listing.',
                  },
                  {
                    title: '3 · Watch the live vendor report build',
                    body: 'Your dashboard shows the price range tightening in real time. PHI metrics update daily. Buyer count grows.',
                  },
                  {
                    title: '4 · Walk into the appraisal armed',
                    body: 'Print the vendor report or open it on a tablet. Vendors stop arguing with comparables — they argue with reality.',
                  },
                  {
                    title: '5 · Convert and launch',
                    body: 'Sign the listing. Premarket campaigns transition cleanly to on-market launches with a queue of warm buyers already waiting.',
                  },
                ]}
              />
            }
          />
        </div>
      </section>

      {/* Pricing — clean and quiet */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="rounded-[2rem] border border-slate-200 bg-white shadow-[0_24px_60px_-30px_rgba(15,23,42,0.18)] p-10 sm:p-16 text-center">
          <p className="text-[11px] font-bold text-[#c64500] uppercase tracking-[0.18em] mb-6">
            Pricing
          </p>
          <p className="text-5xl sm:text-6xl font-bold tracking-tight text-slate-900">
            $200{' '}
            <span className="text-2xl sm:text-3xl font-semibold text-slate-400">
              per campaign
            </span>
          </p>
          <p className="mt-6 text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
            One flat fee per property. No subscription. No setup. No per-buyer charges.
            Run as many campaigns as you like — pay only for the ones you launch.
          </p>
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto text-left">
            {[
              'Unlimited buyer opinions',
              'Live vendor reports (PDF + in-app)',
              'PHI suburb data included',
              'Branded to your agency',
              'No monthly commitment',
              'Cancel any campaign, any time',
            ].map((perk) => (
              <div key={perk} className="flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-[#e48900] flex-shrink-0 mt-0.5" strokeWidth={2} />
                <span className="text-sm text-slate-700 leading-snug">{perk}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust + brand */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-24 sm:pb-32">
        <TwoColumn
          reverse
          left={
            <div className="grid grid-cols-2 gap-4">
              <FeatureCard
                icon={ShieldCheck}
                title="Privacy by default"
                description="Premarket campaigns can stay completely off the public portals. No stale-listing risk. No nosy neighbours."
                accent="emerald"
              />
              <FeatureCard
                icon={TrendingUp}
                title="Pricing built from people"
                description="Aggregated price opinions create a number with a story — not a black-box estimate."
                accent="orange"
              />
              <FeatureCard
                icon={Zap}
                title="Two-minute setup"
                description="Enter the address, drop the photos, write a short brief. Live in under two minutes."
                accent="blue"
              />
              <FeatureCard
                icon={Users}
                title="Buyer queue at launch"
                description="By the time you go on-market, your campaign has already done the hard work."
                accent="violet"
              />
            </div>
          }
          right={
            <div>
              <SectionHeading
                eyebrow="Built for the way agents actually work"
                title="Premarket respects the listing agent's craft"
                subtitle="We've designed every workflow around one principle: your job is to win the listing and protect the vendor — and Premarket is here to make both easier."
              />
            </div>
          }
        />
      </section>

      <ClosingCTA
        title="Run your first campaign this week"
        subtitle="No subscription. No commitment. $200 per listing — pay only when you launch one."
        primaryHref="/join"
        primaryLabel="Start a campaign"
        secondaryHref="/contact"
        secondaryLabel="Talk to our team"
      />

      <PublicSiteFooter />
    </div>
  );
}
