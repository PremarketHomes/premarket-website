'use client';

import {
  BellRing,
  Clock,
  RefreshCw,
  MessageSquare,
  Mail,
  Smartphone,
  Calendar,
  Sparkles,
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

export default function RemindersClient() {
  return (
    <div className="bg-white text-slate-900">
      <PublicSiteNav />
      <MarketingHero
        eyebrow="Reminders"
        title={
          <>
            The follow-ups that{' '}
            <span className="bg-gradient-to-r from-[#e48900] to-[#c64500] bg-clip-text text-transparent">
              follow themselves up
            </span>
            .
          </>
        }
        subtitle="Premarket reminders nudge buyers, re-engage cold campaigns, and surface the next best action — automatically. You stop chasing. The platform does it for you."
        primaryCta={{ href: '/signup', label: 'Start free' }}
        secondaryCta={{ href: '/features', label: 'All features' }}
      />


      {/* What gets automated */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <SectionHeading
            align="center"
            eyebrow="What gets automated"
            title="Every nudge a great agent would make — without you lifting a finger"
            subtitle="Premarket watches every campaign and every buyer. It knows when to reach out, what to say, and when silence is the right answer."
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <FeatureCard
            icon={Clock}
            title="Cold campaign rescue"
            description="If a campaign goes quiet for more than 72 hours, Premarket re-engages the matched buyer pool with a fresh nudge."
            accent="orange"
          />
          <FeatureCard
            icon={MessageSquare}
            title="Post-viewing follow-up"
            description="After every private inspection, the buyer gets a friendly note asking for a price opinion or thoughts. You see the response in your dashboard."
            accent="blue"
          />
          <FeatureCard
            icon={RefreshCw}
            title="Repeat-visit alerts"
            description="When a buyer comes back to look at a property a second or third time, you're notified instantly — that's a serious signal."
            accent="emerald"
          />
          <FeatureCard
            icon={Calendar}
            title="Vendor weekly digest"
            description="Schedule an automatic Friday-morning email to your vendor with the latest report. They love it. You save the call."
            accent="violet"
          />
          <FeatureCard
            icon={BellRing}
            title="New-match alerts"
            description="Buyers in your database get notified the moment a new property matches their criteria — no manual drip campaigns required."
            accent="rose"
          />
          <FeatureCard
            icon={Sparkles}
            title="Smart silence"
            description="Premarket also knows when not to send. We never spam your buyers. Quiet beats noisy every time."
            accent="orange"
          />
        </div>
      </section>

      {/* Channels */}
      <section className="bg-slate-50 border-y border-slate-200/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
          <TwoColumn
            left={
              <div>
                <SectionHeading
                  eyebrow="Channels"
                  title="Email, SMS, push, in-app"
                  subtitle="Reminders meet buyers wherever they actually are. Every channel is opt-in for the recipient and respectful by default."
                />
              </div>
            }
            right={
              <BulletList
                accent="blue"
                items={[
                  {
                    title: 'Email',
                    body: 'Beautifully formatted, mobile-ready emails that look like they came from a thoughtful human.',
                  },
                  {
                    title: 'SMS',
                    body: 'Concise text alerts for the highest-priority moments — new matches, repeat visits, urgent updates.',
                  },
                  {
                    title: 'Push notifications',
                    body: 'For buyers who use the Premarket buyer dashboard or have app alerts enabled.',
                  },
                  {
                    title: 'In-app activity feed',
                    body: 'Every reminder also lands in the buyer\'s personal activity feed inside their dashboard.',
                  },
                ]}
              />
            }
          />
        </div>
      </section>

      <ClosingCTA
        title="Stop chasing. Start closing."
        subtitle="Smart reminders are on by default. Unlimited buyer follow-ups. Free for every agent on the platform."
        primaryHref="/signup"
        primaryLabel="Create free account"
        secondaryHref="/contact"
        secondaryLabel="Talk to us"
      />

      <PublicSiteFooter />
    </div>
  );
}
