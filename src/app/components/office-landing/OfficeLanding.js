import Image from 'next/image';
import { Compass, MessageSquareText, UserCheck, Handshake, ChevronDown } from 'lucide-react';

const PREMARKET_LOGO = 'https://premarketvideos.b-cdn.net/assets/logo.png';
// White wordmark with the orange mark, for navy backgrounds.
const PREMARKET_LOGO_ON_DARK = { src: '/brand/premarket-on-dark.png', width: 900, height: 163 };

const BENEFITS = [
  { Icon: Compass, title: 'Explore buyer interest', body: 'See how buyers respond before you commit to a full traditional marketing campaign.' },
  { Icon: MessageSquareText, title: 'Anonymous pricing opinions', body: 'Gather buyers’ honest views on price, shared without their names attached.' },
  { Icon: UserCheck, title: 'Formal expressions of interest', body: 'Receive formal interest from buyers who are serious about your property.' },
  { Icon: Handshake, title: 'Decide with your agent', body: 'Review the feedback together and make a more informed decision about what comes next.' },
];

const STEPS = [
  (o) => ({ body: `Your ${o.name.split(' ')[0]} agent prepares your Premarket campaign.` }),
  (o) => ({
    body: `Your ${o.name} agent shares your property with their established database of warm, active buyers, inviting anonymous pricing opinions and expressions of formal interest.`,
  }),
  () => ({ body: 'Your agent reviews the results with you.' }),
  () => ({ body: 'Together, you decide the best next step.' }),
];

const CONCERNS = [
  ['Spending on marketing without knowing demand', 'Understand buyer appetite before you invest in a full campaign.'],
  ['Setting an unrealistic asking price', 'Hear what buyers think the property is worth, in their own words.'],
  ['Going public before you’re ready', 'Test the waters first, on your timeline, with your agent guiding you.'],
  ['Not knowing what buyers are thinking', 'Get real feedback instead of guesswork.'],
];

const faqs = (o) => [
  ['Is my property’s privacy protected?', `A Premarket campaign is not a full public marketing campaign, and your ${o.agentLabel} decides how it is shared. Ask your agent exactly what will be visible and to whom before anything goes live. No online service can promise complete confidentiality, as information shared with buyers can be passed on by them.`],
  ['Is a price opinion the same as an offer?', 'No. Buyer pricing opinions are anonymous feedback only. They are not offers, and they do not bind a buyer or you. Buyers can also register formal interest, which your agent will follow up with you.'],
  ['Do I need to run a full public campaign?', 'No. Premarket is a way to learn more first. Whether and when to go to market is entirely your decision, made with your agent.'],
  ['Who do I deal with?', `Your ${o.agentLabel}. Premarket is a technology platform, not a real estate agency. It doesn’t negotiate or accept offers, and your relationship stays with your agent.`],
  ['What are the next steps?', `Speak to your ${o.agentLabel}. They will explain how a Premarket campaign would work for your property and answer questions about timing and costs.`],
];

export default function OfficeLanding({ office }) {
  const { name, navy, blue, logo } = office;

  return (
    <main
      className="font-sans text-slate-800 bg-white"
      style={{ '--navy': navy, '--blue': blue }}
    >
      {/* Hero */}
      <section className="bg-(--navy) text-white">
        <div className="max-w-3xl mx-auto px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-16 sm:pb-24">
          {/* Partnership lockup: Premarket × the office */}
          <div className="py-3 flex items-center gap-4 sm:gap-6">
            <Image
              src={PREMARKET_LOGO_ON_DARK.src}
              alt="Premarket"
              width={PREMARKET_LOGO_ON_DARK.width}
              height={PREMARKET_LOGO_ON_DARK.height}
              priority
              className="h-7 sm:h-8 w-auto"
            />
            <span aria-hidden="true" className="text-xl sm:text-2xl font-light leading-none text-white/50">&times;</span>
            {logo ? (
              <Image src={logo.src} alt={name} width={logo.width} height={logo.height} priority className="h-14 sm:h-16 w-auto" />
            ) : (
              <p className="text-lg sm:text-xl font-semibold tracking-tight">{name}</p>
            )}
          </div>
          <p className="mt-14 text-xs font-semibold uppercase tracking-[0.18em] text-(--blue)">
            In partnership with Premarket
          </p>
          <h1 className="mt-4 text-[2rem] leading-[1.15] sm:text-5xl sm:leading-[1.1] font-semibold tracking-tight text-balance">
            Understand your property&rsquo;s potential before going to market.
          </h1>
          <p className="mt-5 text-base sm:text-lg text-white/80 leading-relaxed">
            {name} has partnered with Premarket to offer a private way to see how buyers respond
            to your home before you commit to a full marketing campaign.
          </p>
        </div>
      </section>

      {/* What it lets you do */}
      <section className="max-w-3xl mx-auto px-5 py-14 sm:py-20">
        <h2 className="text-2xl sm:text-3xl font-semibold text-(--navy) tracking-tight">What Premarket gives you</h2>
        <div className="mt-8 rounded-3xl bg-(--navy) p-6 sm:p-8 text-white border-l-8 border-(--blue) shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-(--blue)">A key advantage</p>
          <h3 className="mt-2 text-2xl sm:text-3xl font-semibold leading-tight tracking-tight text-balance">
            Test the market without the public footprint
          </h3>
          <p className="mt-4 leading-relaxed text-white/90">
            Explore buyer interest without launching a traditional public advertising campaign. If you
            decide not to sell, or adjust your pricing strategy, you can avoid the public listing history
            and advertised price reductions that may come with a conventional campaign.
          </p>
          <p className="mt-4 text-xs leading-relaxed text-white/60">
            This applies when your campaign is shared privately by your agent. It doesn&rsquo;t mean no
            records exist, and privacy can&rsquo;t be guaranteed.
          </p>
        </div>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {BENEFITS.map(({ Icon, title, body }) => (
            <li key={title} className="rounded-2xl border border-slate-200 p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-(--navy)">
                <Icon className="h-5 w-5 text-(--blue)" aria-hidden="true" />
              </span>
              <h3 className="mt-4 font-semibold text-(--navy)">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Process */}
      <section className="bg-slate-50">
        <div className="max-w-3xl mx-auto px-5 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-semibold text-(--navy) tracking-tight">How it works</h2>
          <ol className="mt-8 space-y-5">
            {STEPS.map((step, i) => (
              <li key={i} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--navy) text-sm font-semibold text-white">
                  {i + 1}
                </span>
                <div className="pt-1 leading-relaxed">
                  <p>{step(office).body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Concerns */}
      <section className="max-w-3xl mx-auto px-5 py-14 sm:py-20">
        <h2 className="text-2xl sm:text-3xl font-semibold text-(--navy) tracking-tight">
          Thinking about selling? You&rsquo;re not alone.
        </h2>
        <p className="mt-3 text-slate-600">Common concerns we hear from homeowners, and how Premarket helps.</p>
        <ul className="mt-8 space-y-4">
          {CONCERNS.map(([concern, answer]) => (
            <li key={concern} className="border-l-4 border-(--blue) pl-4">
              <p className="font-semibold text-(--navy)">{concern}</p>
              <p className="mt-1 text-sm text-slate-600 leading-relaxed">{answer}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* FAQ */}
      <section className="bg-slate-50">
        <div className="max-w-3xl mx-auto px-5 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-semibold text-(--navy) tracking-tight">Common questions</h2>
          <div className="mt-8 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
            {faqs(office).map(([q, a]) => (
              <details key={q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-(--navy) [&::-webkit-details-marker]:hidden">
                  {q}
                  <ChevronDown className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Next steps */}
      <section id="next-steps" className="bg-(--navy) text-white scroll-mt-4">
        <div className="max-w-3xl mx-auto px-5 py-16 sm:py-20 text-center">
          {logo && (
            <Image src={logo.src} alt="" width={logo.width} height={logo.height} className="mx-auto mb-6 h-16 w-auto" />
          )}
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-balance">
            Ready to find out more?
          </h2>
          <p className="mt-4 text-white/80 leading-relaxed">
            Reply to the message your agent sent you, or get in touch with them directly. They&rsquo;ll
            talk you through how Premarket could work for your property.
          </p>
        </div>
      </section>

      <footer className="bg-white px-5 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))] text-center text-xs leading-relaxed text-slate-500">
        <p className="flex items-center justify-center gap-2">
          Powered by
          <Image src={PREMARKET_LOGO} alt="Premarket" width={96} height={24} unoptimized className="h-4 w-auto" />
        </p>
        <p className="mx-auto mt-3 max-w-xl">
          Premarket is a technology platform and is not a real estate agency. It does not conduct
          negotiations or accept offers. Buyer price opinions are not offers. Nothing on this page
          is a promise of a sale or of any particular price.
        </p>
      </footer>
    </main>
  );
}
