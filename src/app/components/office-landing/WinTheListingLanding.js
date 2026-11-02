import Image from 'next/image';

const PREMARKET_LOGO = 'https://premarketvideos.b-cdn.net/assets/logo.png';

const OBJECTIONS = [
  'We’re not sure if now is the right time.',
  'We don’t want to spend thousands on marketing just to see what happens.',
  'We want to know what buyers would actually pay.',
];

const BENEFITS = [
  { title: 'Secure the opportunity', body: 'Offer a structured premarket approach that helps hesitant vendors take the next step with you.' },
  { title: 'Put your database to work', body: 'Invite relevant buyers to provide anonymous pricing opinions and register interest.' },
  { title: 'Build confidence with evidence', body: 'Give vendors meaningful buyer feedback before deciding on a public launch strategy.' },
];

// Headline and intro copy, shared by this page and the Agent Hub tab. `Heading` is h1 on the
// standalone page and h2 inside the hub, which already has its own h1.
export function WinTheListingHeroCopy({ Heading = 'h1' }) {
  return (
    <>
      <Heading className="mt-4 text-[2rem] leading-[1.15] sm:text-5xl sm:leading-[1.1] font-semibold tracking-tight text-balance">
        Give vendors a reason to choose you before they&rsquo;re ready to sell.
      </Heading>
      <p className="mt-6 text-base sm:text-lg text-white/80 leading-relaxed">
        Not every homeowner is ready for a full marketing campaign. That doesn&rsquo;t mean
        they&rsquo;re not ready to start the conversation.
      </p>
      <p className="mt-4 text-base sm:text-lg text-white/80 leading-relaxed">
        Premarket gives you another way to secure the listing opportunity, demonstrate value and help
        vendors understand buyer expectations before launching publicly.
      </p>
    </>
  );
}

export function WinTheListingSections() {
  return (
    <>
      {/* 2. The opportunity */}
      <section className="max-w-3xl mx-auto px-5 py-14 sm:py-20">
        <h2 className="text-2xl sm:text-3xl font-semibold text-(--navy) tracking-tight">
          Turn hesitation into an opportunity.
        </h2>
        <p className="mt-5 leading-relaxed text-slate-700">
          When a vendor isn&rsquo;t ready to commit to a traditional campaign, you need more than another
          appraisal or follow-up call.
        </p>
        <ul className="mt-8 space-y-4">
          {OBJECTIONS.map((line) => (
            <li key={line} className="border-l-4 border-(--blue) pl-5 text-lg sm:text-xl font-semibold italic leading-snug text-(--navy)">
              &ldquo;{line}&rdquo;
            </li>
          ))}
        </ul>
        <p className="mt-8 text-lg font-semibold leading-snug text-(--navy)">
          You don&rsquo;t need to push them into a full campaign. You can offer a first step.
        </p>
      </section>

      {/* 3. Why it helps */}
      <section className="bg-slate-50">
        <div className="max-w-3xl mx-auto px-5 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-semibold text-(--navy) tracking-tight">
            Win the relationship before you launch the campaign.
          </h2>
          <ol className="mt-8 space-y-5">
            {BENEFITS.map(({ title, body }, i) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--navy) text-sm font-semibold text-white">
                  {i + 1}
                </span>
                <div className="pt-1">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-(--navy)">{title}</h3>
                  <p className="mt-1 leading-relaxed text-slate-700">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 4. The listing presentation */}
      <section className="max-w-3xl mx-auto px-5 py-14 sm:py-20">
        <h2 className="text-2xl sm:text-3xl font-semibold text-(--navy) tracking-tight">
          The listing presentation changes.
        </h2>
        <figure className="mt-8 rounded-3xl bg-(--navy) p-6 sm:p-10 text-white border-l-8 border-(--blue) shadow-lg">
          <figcaption className="text-xs font-semibold uppercase tracking-[0.18em] text-(--blue)">
            Try saying this
          </figcaption>
          <blockquote className="mt-4 space-y-4 text-lg sm:text-xl leading-relaxed text-white/95">
            <p>
              &ldquo;Before we ask you to commit to a full marketing campaign, why don&rsquo;t we introduce
              your property to buyers in our database, collect their opinions and see what interest we can
              generate?
            </p>
            <p className="font-semibold text-white">
              That gives us real feedback to help decide the best next step.&rdquo;
            </p>
          </blockquote>
        </figure>
      </section>
    </>
  );
}

export function WinTheListingClosing({ logo }) {
  return (
    <section className="bg-(--navy) text-white">
      <div className="max-w-3xl mx-auto px-5 py-16 sm:py-20 text-center">
        {logo && (
          <Image src={logo.src} alt="" width={logo.width} height={logo.height} className="mx-auto mb-6 h-16 w-auto" />
        )}
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-balance">
          Don&rsquo;t just pitch the listing. Give the vendor a plan.
        </h2>
        <p className="mt-4 text-white/80 leading-relaxed">
          Differentiate your presentation. Reduce the pressure. Create a reason for the vendor to move
          forward with you.
        </p>
      </div>
    </section>
  );
}

export default function WinTheListingLanding({ office }) {
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
            Harcourts Property Hub <span aria-hidden="true">&middot;</span> Win the Listing
          </p>
          <WinTheListingHeroCopy />
        </div>
      </section>

      <WinTheListingSections />

      <WinTheListingClosing logo={logo} />

      <footer className="bg-white px-5 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))] text-center text-xs leading-relaxed text-slate-500">
        <p className="flex items-center justify-center gap-2">
          Powered by
          <Image src={PREMARKET_LOGO} alt="Premarket" width={96} height={24} unoptimized className="h-4 w-auto" />
        </p>
        <p className="mx-auto mt-3 max-w-xl">
          Buyer pricing opinions are anonymous feedback only. They are not formal valuations or offers.
          Sharing a property with a controlled buyer database is not public advertising, but privacy cannot
          be guaranteed. Premarket does not replace agency agreements, vendor authorisation or any other
          required listing process, and does not guarantee a listing, an offer, a sale price or a faster sale.
        </p>
      </footer>
    </main>
  );
}
