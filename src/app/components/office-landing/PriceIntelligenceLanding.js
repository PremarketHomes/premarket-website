import Image from 'next/image';

const PREMARKET_LOGO = 'https://premarketvideos.b-cdn.net/assets/logo.png';

const STEPS = [
  'Invite buyers to share their honest opinion of value.',
  'Collect feedback throughout the live campaign.',
  'Identify patterns and potential gaps between buyer expectations and asking price.',
  'Use that information to support timely, informed vendor conversations.',
];

// Headline and intro copy, shared by this page and the Agent Hub tab. `Heading` is h1 on the
// standalone page and h2 inside the hub, which already has its own h1.
export function PriceIntelligenceHeroCopy({ Heading = 'h1' }) {
  return (
    <>
      <Heading className="mt-4 text-[2rem] leading-[1.15] sm:text-5xl sm:leading-[1.1] font-semibold tracking-tight text-balance">
        The market has changed. It&rsquo;s time to change the conversation.
      </Heading>
      <p className="mt-6 text-base sm:text-lg font-semibold leading-relaxed text-white">
        Higher interest rates. Reduced borrowing power. More cautious buyers. Longer campaigns.
      </p>
      <p className="mt-4 text-base sm:text-lg text-white/80 leading-relaxed">
        We&rsquo;re operating in a different market now. Properties aren&rsquo;t attracting the same
        urgency, and waiting for offers alone isn&rsquo;t giving us the information we need.
      </p>
      <p className="mt-4 text-base sm:text-lg text-white/80 leading-relaxed">
        It&rsquo;s time to start listening to what buyers are actually telling us.
      </p>
    </>
  );
}

export function PriceIntelligenceSections() {
  return (
    <>
      {/* 2. Market reality */}
      <section className="max-w-3xl mx-auto px-5 py-14 sm:py-20">
        <h2 className="text-2xl sm:text-3xl font-semibold text-(--navy) tracking-tight">Buyers&rsquo; borrowing power has changed.</h2>
        <div className="mt-8 border-l-4 border-(--blue) pl-5">
          <p className="text-5xl sm:text-6xl font-semibold tracking-tight text-(--navy)">~$90,000</p>
          <p className="mt-2 leading-relaxed text-slate-700">
            Estimated reduction in borrowing capacity for a median-income household after four interest-rate
            increases in 2026, around 9% of purchasing power.
          </p>
          <p className="mt-2 text-xs text-slate-500">Source: Cotality, 29 September 2026.</p>
        </div>
        <p className="mt-6 text-sm leading-relaxed text-slate-600">
          Conditions vary by suburb, price point and property type. Not every property is affected equally.
        </p>
      </section>

      {/* 3. The problem */}
      <section className="max-w-3xl mx-auto px-5 pb-14 sm:pb-20">
        <div className="rounded-3xl bg-(--navy) p-6 sm:p-10 text-white border-l-8 border-(--blue) shadow-lg">
          <h2 className="text-3xl sm:text-4xl font-semibold leading-tight tracking-tight text-balance">
            An inspection isn&rsquo;t a pricing opinion.
          </h2>
          <p className="mt-5 leading-relaxed text-white/90">
            Buyers are still inspecting properties, but many aren&rsquo;t prepared to make offers at vendor
            expectations.
          </p>
          <p className="mt-4 leading-relaxed text-white/90">
            A campaign with ten inspections and no offers tells us very little about the price buyers would
            actually consider.
          </p>
          <p className="mt-6 text-xl sm:text-2xl font-semibold leading-snug text-(--blue)">
            Ten genuine pricing opinions give us something to discuss.
          </p>
        </div>
      </section>

      {/* 4. Why HPH */}
      <section className="bg-slate-50">
        <div className="max-w-3xl mx-auto px-5 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-semibold text-(--navy) tracking-tight">
            We need to get our days on market back down.
          </h2>
          <p className="mt-5 leading-relaxed text-slate-700">
            At Harcourts Property Hub, the focus is simple: collect more meaningful buyer feedback, identify
            pricing resistance earlier and give vendors the information they need to make decisions.
          </p>
          <p className="mt-4 leading-relaxed text-slate-700">
            Rather than waiting until week six to have a difficult pricing conversation, let&rsquo;s start
            gathering evidence from the first inspection and continue throughout the campaign.
          </p>
          <p className="mt-8 border-l-4 border-(--blue) pl-5 text-2xl sm:text-3xl font-semibold leading-tight tracking-tight text-(--navy) text-balance">
            Every inspection is an opportunity for price education.
          </p>
          <p className="mt-4 pl-6 text-sm sm:text-base font-semibold text-slate-600">
            Collect the opinion. Understand the feedback. Share the evidence. Have the conversation.
          </p>
        </div>
      </section>

      {/* 5. How it helps */}
      <section className="max-w-3xl mx-auto px-5 py-14 sm:py-20">
        <h2 className="text-2xl sm:text-3xl font-semibold text-(--navy) tracking-tight">
          Stop guessing where buyers see value.
        </h2>
        <p className="mt-5 leading-relaxed text-slate-700">
          Price Intelligence gives HPH agents a simple way to collect anonymous buyer pricing opinions and
          present that feedback to vendors throughout the sales campaign.
        </p>
        <p className="mt-4 leading-relaxed text-slate-700">
          It doesn&rsquo;t replace your expertise. It gives you more evidence to support it.
        </p>
        <ol className="mt-8 space-y-5">
          {STEPS.map((step, i) => (
            <li key={step} className="flex gap-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--navy) text-sm font-semibold text-white">
                {i + 1}
              </span>
              <p className="pt-1 leading-relaxed">{step}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

export function PriceIntelligenceClosing({ logo }) {
  return (
    <section className="bg-(--navy) text-white">
      <div className="max-w-3xl mx-auto px-5 py-16 sm:py-20 text-center">
        {logo && (
          <Image src={logo.src} alt="" width={logo.width} height={logo.height} className="mx-auto mb-6 h-16 w-auto" />
        )}
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-balance">
          Let&rsquo;s get ahead of the market.
        </h2>
        <p className="mt-4 text-white/80 leading-relaxed">
          We can&rsquo;t control interest rates or buyer confidence. But we can control how quickly we
          collect feedback, educate our vendors and respond.
        </p>
        <p className="mt-6 font-semibold text-(--blue)">
          Better buyer feedback. Earlier vendor conversations. More informed pricing decisions.
        </p>
      </div>
    </section>
  );
}

export default function PriceIntelligenceLanding({ office }) {
  const { name, navy, blue, logo } = office;

  return (
    <main className="font-sans text-slate-800 bg-white" style={{ '--navy': navy, '--blue': blue }}>
      {/* 1. Hero */}
      <section className="bg-(--navy) text-white">
        <div className="max-w-3xl mx-auto px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-16 sm:pb-24">
          <div className="py-3">
            <Image src={logo.src} alt={name} width={logo.width} height={logo.height} priority className="h-14 sm:h-16 w-auto" />
          </div>
          <p className="mt-14 text-xs font-semibold uppercase tracking-[0.18em] text-(--blue)">
            Harcourts Property Hub <span aria-hidden="true">&middot;</span> Price Intelligence
          </p>
          <PriceIntelligenceHeroCopy />
        </div>
      </section>

      <PriceIntelligenceSections />

      <PriceIntelligenceClosing logo={logo} />

      <footer className="bg-white px-5 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))] text-center text-xs leading-relaxed text-slate-500">
        <p className="flex items-center justify-center gap-2">
          Powered by
          <Image src={PREMARKET_LOGO} alt="Premarket" width={96} height={24} unoptimized className="h-4 w-auto" />
        </p>
        <p className="mx-auto mt-3 max-w-xl">
          Buyer pricing opinions are anonymous feedback only. They are not formal valuations or offers, and
          collecting feedback does not guarantee a faster sale or any particular price.
        </p>
      </footer>
    </main>
  );
}
