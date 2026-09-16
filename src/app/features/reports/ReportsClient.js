'use client';

import {
  FileBarChart,
  TrendingUp,
  Users,
  Share2,
  Mail,
  RefreshCw,
  ShieldCheck,
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
} from '../../components/marketing/MarketingShell';

export default function ReportsClient() {
  return (
    <div className={`bg-white text-slate-900 ${playfairDisplay.variable}`}>
      <PublicSiteNav />
      <MarketingHero
        eyebrow="Reports"
        title={
          <>
            Vendor reports that{' '}
            <span className="bg-gradient-to-r from-[#e48900] to-[#c64500] bg-clip-text text-transparent">
              update themselves
            </span>
            .
          </>
        }
        subtitle="Every Premarket campaign builds a vendor report from real buyer evidence. New price opinions and interest are already there the next time you open it."
        primaryCta={{ href: '/join', label: 'Try Premarket free' }}
        secondaryCta={{ href: '/features', label: 'All features' }}
      />


      {/* What's in a report */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <SectionHeading
            align="center"
            eyebrow="What's in a Premarket report"
            title="Every signal that matters, in one document"
            subtitle="Everything a vendor wants to know about their property's performance, presented with the clarity and confidence of a research note — not a screenshot of a CRM."
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <FeatureCard
            icon={TrendingUp}
            title="Price opinion distribution"
            description="See exactly how buyers are valuing the property — minimum, maximum, median, and the shape of the spread."
            accent="orange"
          />
          <FeatureCard
            icon={Users}
            title="Buyer engagement"
            description="Total inquiries and registered interest from real buyers who've opened the campaign."
            accent="blue"
          />
          <FeatureCard
            icon={Share2}
            title="Shareable summary"
            description="A clean executive summary the vendor can read in two minutes — and a deeper dive for the curious."
            accent="rose"
          />
          <FeatureCard
            icon={RefreshCw}
            title="Always current"
            description="Reports never go stale. Every open pulls the latest evidence directly from the platform."
            accent="orange"
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
                  eyebrow="How it works"
                  title="From campaign live to report shared in under a minute"
                  subtitle="The hard work is done by the platform. You just open the report when your vendor asks for one."
                />
              </div>
            }
            right={
              <BulletList
                items={[
                  {
                    title: '1 · Launch the campaign',
                    body: 'Set up the listing in two minutes. The report is generated automatically.',
                  },
                  {
                    title: '2 · Buyers engage',
                    body: 'Anonymous price opinions, registered interest, and engagement signals start flowing in.',
                  },
                  {
                    title: '3 · Report builds itself',
                    body: 'Every new signal is already there the next time you open the report. No manual entry, no screenshots, no spreadsheets.',
                  },
                  {
                    title: '4 · Share with the vendor',
                    body: 'Send a link or export a PDF for the meeting.',
                  },
                  {
                    title: '5 · Have the price conversation',
                    body: 'Walk into the next vendor meeting with evidence — not opinions. The whole conversation changes.',
                  },
                ]}
              />
            }
          />
        </div>
      </section>

      {/* Trust */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <TwoColumn
          reverse
          left={
            <div className="grid grid-cols-2 gap-4">
              <FeatureCard
                icon={ShieldCheck}
                title="Anonymous by default"
                description="Buyer identities are masked in vendor-facing reports. Privacy is non-negotiable."
                accent="emerald"
              />
              <FeatureCard
                icon={Mail}
                title="Branded for you"
                description="Reports carry your agency branding so the vendor sees you as the source of insight."
                accent="orange"
              />
              <FeatureCard
                icon={RefreshCw}
                title="Generate anytime"
                description="Open the report whenever you need it — it reflects the campaign exactly as it stands right now."
                accent="blue"
              />
              <FeatureCard
                icon={FileBarChart}
                title="Export to PDF"
                description="One-click export for vendor meetings, paper packs and email attachments."
                accent="violet"
              />
            </div>
          }
          right={
            <div>
              <SectionHeading
                eyebrow="Built for trust"
                title="Reports your vendor will actually read"
                subtitle="Premarket reports are designed to be skimmed in two minutes and trusted in five."
              />
            </div>
          }
        />
      </section>

      <ClosingCTA
        title="Have your next vendor meeting with evidence"
        subtitle="Live reports built from the buyers themselves — not from a market estimate."
        primaryHref="/join"
        primaryLabel="Start free"
        secondaryHref="/contact"
        secondaryLabel="Book a walkthrough"
      />

      <PublicSiteFooter />
    </div>
  );
}
