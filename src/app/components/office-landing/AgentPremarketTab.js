// Agent-facing "Premarket" tab for the HPH Agent Hub. This is written for agents running a campaign.
// The vendor-facing explanation lives on /hph and is linked from here rather than copied.

const VENDOR_PAGE_URL = 'https://premarket.homes/hph';

const STEPS = [
  { title: 'Introduce the property', body: 'Share the property with relevant buyers in your database, by email, SMS or your usual channels.' },
  { title: 'Invite anonymous opinions of value', body: 'Buyers can give a price opinion without creating an account, and without their name attached.' },
  { title: 'Identify interested buyers', body: 'Buyers can also register interest, showing you who is worth following up, including for private inspections by appointment.' },
  { title: 'Share the feedback with the vendor', body: 'Take the buyer feedback to the vendor as evidence, in a report that builds from the campaign.' },
  { title: 'Decide the next step together', body: 'Use the insights to inform your public campaign strategy, pricing expectations or a potential off-market opportunity.' },
];

export function AgentPremarketHeroCopy({ Heading = 'h2' }) {
  return (
    <>
      <Heading className="mt-4 text-[2rem] leading-[1.15] sm:text-5xl sm:leading-[1.1] font-semibold tracking-tight text-balance">
        Understand buyer expectations before you go to market.
      </Heading>
      <p className="mt-6 text-base sm:text-lg text-white/80 leading-relaxed">
        Once you&rsquo;ve secured the listing, Premarket gives you a way to hear from the buyers you
        already know before you commit to a public campaign.
      </p>
    </>
  );
}

export function AgentPremarketSections() {
  return (
    <>
      <section className="max-w-3xl mx-auto px-5 py-14 sm:py-20">
        <h2 className="text-2xl sm:text-3xl font-semibold text-(--navy) tracking-tight">
          How it works for you.
        </h2>
        <ol className="mt-8 space-y-5">
          {STEPS.map(({ title, body }, i) => (
            <li key={title} className="flex gap-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--navy) text-sm font-semibold text-white">
                {i + 1}
              </span>
              <div className="pt-1">
                <h3 className="font-semibold text-(--navy)">{title}</h3>
                <p className="mt-1 leading-relaxed text-slate-700">{body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-8 text-sm leading-relaxed text-slate-600">
          Whether and when to go public stays the vendor&rsquo;s decision, made with you.
        </p>
      </section>

      <section className="bg-slate-50">
        <div className="max-w-3xl mx-auto px-5 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-semibold text-(--navy) tracking-tight">
            Sharing Premarket with a vendor?
          </h2>
          <p className="mt-5 leading-relaxed text-slate-700">
            Some homeowners want to understand how Premarket works before they agree to a campaign. Send
            them the HPH vendor information page, written for homeowners.
          </p>
          <a
            href={VENDOR_PAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-full border-2 border-(--navy) px-6 text-sm font-semibold text-(--navy) transition-colors hover:bg-(--navy) hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--blue)"
          >
            View the Vendor Information Page <span aria-hidden="true">&rarr;</span>
          </a>
        </div>
      </section>
    </>
  );
}

export function AgentPremarketClosing() {
  return (
    <section className="bg-(--navy) text-white">
      <div className="max-w-3xl mx-auto px-5 py-16 sm:py-20 text-center">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-balance">
          Don&rsquo;t go to market guessing what buyers think.
        </h2>
        <p className="mt-4 font-semibold text-(--blue)">
          Start the campaign with meaningful feedback.
        </p>
      </div>
    </section>
  );
}
