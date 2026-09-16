'use client';

import {
  FileBarChart,
  TrendingUp,
  Users,
  Activity,
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
        subtitle="Every Premarket campaign builds a live vendor report from the buyer evidence as it arrives. Open it Tuesday. It's already updated by Friday."
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <FeatureCard
            icon={TrendingUp}
            title="Price opinion distribution"
            description="See exactly how buyers are valuing the property — minimum, maximum, median, and the shape of the spread."
            accent="orange"
          />
          <FeatureCard
            icon={Users}
            title="Buyer engagement"
            description="Total inquiries, registered interest, return visits, and the buyers who came back to look twice."
            accent="blue"
          />
          <FeatureCard
            icon={Activity}
            title="Engagement velocity"
            description="How fast the property is gathering momentum — is it heating up, cooling down, or sitting flat?"
            accent="emerald"
          />
          <FeatureCard
            icon={FileBarChart}
            title="PHI context"
            description="Compare the property's traction against the live PHI scores for its suburb. Is the local market hot or cold right now?"
            accent="violet"
          />
          <FeatureCard
            icon={Share2}
            title="Shareable summary"
            description="A clean executive summary the vendor can read in two minutes — and a deeper dive for the curious."
            accent="rose"
          />
          <FeatureCard
            icon={RefreshCw}
            title="Always live"
            description="Reports never go stale. Every refresh pulls the latest evidence directly from the platform."
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
                  subtitle="The hard work is done by the platform. You just open the report when your vendor asks for one — or set it to email automatically every Friday."
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
                    body: 'Every new signal updates the report instantly. No manual entry. No screenshots. No spreadsheets.',
                  },
                  {
                    title: '4 · Share with the vendor',
                    body: 'Send a link, send a PDF, or schedule weekly auto-emails. Your call.',
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
                title="Re-run anytime"
                description="Need a snapshot from last Tuesday? Reports preserve a daily timeline you can scroll through."
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
                subtitle="Premarket reports are designed to be skimmed in two minutes and trusted in five. Designed by ex-investment-bank UI people. Built for property."
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
