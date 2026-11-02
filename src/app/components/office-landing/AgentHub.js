'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { WinTheListingHeroCopy, WinTheListingSections, WinTheListingClosing } from './WinTheListingLanding';
import { AgentPremarketHeroCopy, AgentPremarketSections, AgentPremarketClosing } from './AgentPremarketTab';
import { PriceIntelligenceHeroCopy, PriceIntelligenceSections, PriceIntelligenceClosing } from './PriceIntelligenceLanding';

const PREMARKET_LOGO = 'https://premarketvideos.b-cdn.net/assets/logo.png';
// White wordmark with the orange mark, for navy backgrounds.
const PREMARKET_LOGO_ON_DARK = { src: '/brand/premarket-on-dark.png', width: 900, height: 163 };

const TABS = [
  { id: 'win-the-listing', label: 'Win the Listing', HeroCopy: WinTheListingHeroCopy, Sections: WinTheListingSections, Closing: WinTheListingClosing },
  { id: 'premarket', label: 'Premarket', HeroCopy: AgentPremarketHeroCopy, Sections: AgentPremarketSections, Closing: AgentPremarketClosing },
  { id: 'price-intelligence', label: 'Price Intelligence', HeroCopy: PriceIntelligenceHeroCopy, Sections: PriceIntelligenceSections, Closing: PriceIntelligenceClosing },
];

const idFromHash = () => {
  const id = window.location.hash.slice(1);
  return TABS.some((t) => t.id === id) ? id : null;
};

export default function AgentHub({ office }) {
  const { name, navy, blue, logo } = office;
  const [active, setActive] = useState(TABS[0].id);
  const headerRef = useRef(null);

  // Tabs are linkable (#premarket etc.) so a specific tab can be shared with agents.
  useEffect(() => {
    const sync = () => {
      const id = idFromHash();
      if (id) setActive(id);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const select = useCallback((id) => {
    setActive(id);
    try {
      window.history.replaceState(null, '', `#${id}`);
    } catch {}
    // If the sticky tab bar is pinned, return to the top of the new tab rather than mid-page.
    const headerBottom = headerRef.current ? headerRef.current.offsetHeight : 0;
    if (window.scrollY > headerBottom) window.scrollTo({ top: headerBottom });
  }, []);

  const onKeyDown = (e, index) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = TABS[(index + step + TABS.length) % TABS.length];
    select(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  return (
    <main className="font-sans text-slate-800 bg-white" style={{ '--navy': navy, '--blue': blue }}>
      <header ref={headerRef} className="bg-(--navy) text-white">
        <div className="max-w-3xl mx-auto px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-10 sm:pb-12">
          {/* Partnership lockup: Premarket | the office */}
          <div className="py-3 flex items-center gap-4 sm:gap-6">
            <Image
              src={PREMARKET_LOGO_ON_DARK.src}
              alt="Premarket"
              width={PREMARKET_LOGO_ON_DARK.width}
              height={PREMARKET_LOGO_ON_DARK.height}
              priority
              className="h-7 sm:h-10 w-auto"
            />
            <span aria-hidden="true" className="h-10 sm:h-14 w-px bg-white/30" />
            <Image src={logo.src} alt={name} width={logo.width} height={logo.height} priority className="h-11 sm:h-16 w-auto" />
          </div>
          <p className="mt-14 min-[360px]:whitespace-nowrap text-[0.7rem] sm:text-xs font-semibold uppercase tracking-[0.12em] sm:tracking-[0.18em] text-(--blue)">
            Harcourts Property Hub <span aria-hidden="true">&middot;</span> Agent Hub
          </p>
          <h1 className="mt-4 text-[2rem] leading-[1.15] sm:text-5xl sm:leading-[1.1] font-semibold tracking-tight text-balance">
            One platform. Every stage of the campaign.
          </h1>
          <p className="mt-5 text-base sm:text-lg text-white/80 leading-relaxed">
            Win the listing. Understand your buyers. Educate your vendors.
          </p>
        </div>
      </header>

      <div className="sticky top-0 z-20 border-b border-white/15 bg-(--navy)">
        <div role="tablist" aria-label="Agent Hub sections" className="max-w-3xl mx-auto flex sm:grid sm:grid-cols-3 px-2 sm:px-5">
          {TABS.map(({ id, label }, i) => {
            const selected = id === active;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={selected}
                aria-controls={`panel-${id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => select(id)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={`min-h-14 flex-auto min-[360px]:whitespace-nowrap border-b-4 px-1.5 text-[0.65rem] sm:text-xs font-semibold uppercase leading-tight tracking-[0.06em] sm:tracking-[0.14em] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--blue) ${
                  selected ? 'border-(--blue) text-white' : 'border-transparent text-white/60 hover:text-white'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {TABS.map(({ id, label, HeroCopy, Sections, Closing }) => (
        <div key={id} role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={id !== active}>
          <section className="bg-(--navy) text-white">
            <div className="max-w-3xl mx-auto px-5 pt-10 pb-16 sm:pt-14 sm:pb-24">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-(--blue)">{label}</p>
              <HeroCopy Heading="h2" />
            </div>
          </section>
          <Sections />
          <Closing />
        </div>
      ))}

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
