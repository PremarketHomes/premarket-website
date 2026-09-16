'use client';

import {
  Briefcase,
  Zap,
  TrendingUp,
  Eye,
  Users,
  BookOpen,
  ShieldCheck,
  Handshake,
  Activity,
  Target,
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

export default function BuyersAgentsClient() {
  return (
    <div className="bg-white text-slate-900">
      <PublicSiteNav />
      <MarketingHero
        eyebrow="For buyer's agents"
        title={
          <>
            See premarket properties{' '}
            <span className="bg-gradient-to-r from-[#e48900] to-[#c64500] bg-clip-text text-transparent">
              before the portals do
            </span>
            .
          </>
        }
        subtitle="Get early access to private listings. Submit professional price opinions on behalf of clients. Register strong interest before the rest of the market arrives."
        primaryCta={{ href: '/signup', label: 'Create free account' }}
        secondaryCta={{ href: '/contact', label: 'Talk to our team' }}
      />


      {/* Why buyer's agents love it */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <SectionHeading
            align="center"
            eyebrow="Why it works"
            title="The unfair advantage your clients are paying you for"
            subtitle="Your value is access, judgement, and timing. Premarket gives you all three — packaged into one workflow."
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <FeatureCard
            icon={Zap}
            title="First-mover advantage"
            description="See premarket-only listings days or weeks before they go public. Inspect privately. Negotiate before there's a queue."
            accent="orange"
          />
          <FeatureCard
            icon={TrendingUp}
            title="Submit price opinions for clients"
            description="Translate your buyer brief into a real-time market signal. The listing agent reads it. Your client looks like the most credible buyer in the room."
            accent="violet"
          />
          <FeatureCard
            icon={Handshake}
            title="Register strong interest"
            description="Lock in your client's spot at the front of the line. Listing agents see registered interest from named buyer's agents and respond first."
            accent="emerald"
          />
          <FeatureCard
            icon={Activity}
            title="Live PHI scoring per suburb"
            description="Eight live indicators tell you which suburbs are heating up, cooling down, or sitting in a sweet spot for your client."
            accent="blue"
          />
          <FeatureCard
            icon={Target}
            title="Watched areas with smart alerts"
            description="Track every suburb you operate in. Get alerted the moment new properties match your active client briefs."
            accent="rose"
          />
          <FeatureCard
            icon={BookOpen}
            title="Direct line to listing agents"
            description="No portals between you and the deal. Your engagement is signal — and the listing agent treats it that way."
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
                  eyebrow="Workflow"
                  title="How buyer's agents actually use it"
                  subtitle="A simple loop that compounds into more deals, better outcomes, and stronger client retention."
                />
              </div>
            }
            right={
              <BulletList
                accent="violet"
                items={[
                  {
                    title: '1 · Set your watched suburbs',
                    body: 'Track every postcode you operate in. We\'ll alert you the second new properties or premarket campaigns appear.',
                  },
                  {
                    title: '2 · Match new listings to clients',
                    body: 'When a new property matches an active client brief, your dashboard surfaces it instantly with PHI context.',
                  },
                  {
                    title: '3 · Inspect and analyse',
                    body: 'Book a private inspection through the platform. Compare against the live buyer-evidence dashboard for that area.',
                  },
                  {
                    title: '4 · Submit a professional price opinion',
                    body: 'Show the listing agent that your client is serious, informed, and represented. This earns priority every time.',
                  },
                  {
                    title: '5 · Register strong interest',
                    body: 'Lock your client into the buyer pool. The listing agent gets an instant notification with your contact details.',
                  },
                ]}
              />
            }
          />
        </div>
      </section>

      {/* Trust + privacy */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <TwoColumn
          reverse
          left={
            <div className="grid grid-cols-2 gap-4">
              <FeatureCard
                icon={ShieldCheck}
                title="Verified agents"
                description="Every buyer's agent on the platform is verified — listing agents trust the engagement they see."
                accent="emerald"
              />
              <FeatureCard
                icon={Eye}
                title="Privacy by default"
                description="Your client briefs and search history stay yours. We never sell leads."
                accent="blue"
              />
              <FeatureCard
                icon={Users}
                title="No portal noise"
                description="Direct line to listing agents — no intermediaries skimming the conversation."
                accent="orange"
              />
              <FeatureCard
                icon={Briefcase}
                title="CRM-ready"
                description="Export client engagement and price opinions into your existing buyer's agent workflow."
                accent="violet"
              />
            </div>
          }
          right={
            <div>
              <SectionHeading
                eyebrow="Built around how you actually work"
                title="Premarket respects the buyer's agent role"
                subtitle="We've designed every workflow with one principle in mind: the buyer's agent is the trusted intermediary, not a lead in someone else's funnel."
              />
            </div>
          }
        />
      </section>

      <ClosingCTA
        title="Start showing clients premarket properties this week"
        subtitle="Free buyer's agent accounts. Unlimited price opinions. Instant alerts. Direct contact with listing agents."
        primaryHref="/signup"
        primaryLabel="Create free account"
        secondaryHref="/contact"
        secondaryLabel="Talk to our team"
      />

      <PublicSiteFooter />
    </div>
  );
}
