'use client';

export default function DevDocsContent({ sectionKey }) {
  const prose = 'text-sm text-slate-700 leading-relaxed space-y-3';
  const heading = 'text-sm font-semibold text-slate-900 mt-4 mb-2';
  const code = 'bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs font-mono';
  const table = 'w-full text-sm border-collapse';
  const th = 'text-left text-xs font-semibold text-slate-500 uppercase tracking-wider py-2 px-3 border-b border-slate-200';
  const td = 'py-2 px-3 border-b border-slate-100 text-slate-700';

  switch (sectionKey) {
    case 'architecture':
      return (
        <div className={prose}>
          <p>Premarket is a three-tier platform for off-market, pre-market and on-market real estate.</p>
          <p className={heading}>Components</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong>Next.js Website</strong> — Next.js 15 (App Router) deployed on Vercel at <span className={code}>premarket.homes</span>. Handles the marketing site, agent dashboard, API endpoints, cron jobs, and admin tools.</li>
            <li><strong>Flutter Mobile App</strong> — iOS and Android app for buyers and agents. Connects directly to Firebase/Firestore for real-time data.</li>
            <li><strong>Firebase Functions</strong> — Handles background triggers (new property, new offer, signup), Cloud Tasks (image/video generation), Puppeteer scrapers, and scheduled newsletters.</li>
            <li><strong>Firestore</strong> — Primary database. Collections include users, properties, offers, likes, marketScores, marketTrends, docSessions, and more.</li>
          </ul>
          <p className={heading}>Deployment</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Website deploys automatically via Vercel on push to <span className={code}>main</span></li>
            <li>Firebase Functions deploy via <span className={code}>firebase deploy --only functions</span></li>
            <li>Cron jobs configured in <span className={code}>vercel.json</span> and execute as Vercel Cron Functions</li>
          </ul>
          <p className={heading}>Quick Navigation Guide</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong>Finding an API endpoint:</strong> Go to <span className={code}>src/app/api/</span>, browse by domain folder.</li>
            <li><strong>Finding a page:</strong> Public pages at <span className={code}>src/app/[page]/page.js</span>. Dashboard pages at <span className={code}>src/app/dashboard/[page]/page.js</span>.</li>
            <li><strong>Finding business logic:</strong> Check <span className={code}>api/services/</span> for external API clients, <span className={code}>api/v1/helpers.js</span> for score algorithms.</li>
          </ul>
        </div>
      );

    case 'data-model':
      return (
        <div className={prose}>
          <table className={table}>
            <thead><tr><th className={th}>Collection</th><th className={th}>Key Fields</th><th className={th}>Purpose</th></tr></thead>
            <tbody>
              <tr><td className={td}><span className={code}>users</span></td><td className={td}>firstName, lastName, email, isAgent, isBuyer, pro, superAdmin, apiAccess</td><td className={td}>All platform users</td></tr>
              <tr><td className={td}><span className={code}>properties</span></td><td className={td}>address, price, userId, visibility, location, gotoMarketGoal, isEager, stats</td><td className={td}>Property listings</td></tr>
              <tr><td className={td}><span className={code}>offers</span></td><td className={td}>propertyId, type, serious, seriousnessLevel, offerAmount</td><td className={td}>Buyer opinions and offers</td></tr>
              <tr><td className={td}><span className={code}>likes</span></td><td className={td}>propertyId, userId</td><td className={td}>Property likes/saves</td></tr>
              <tr><td className={td}><span className={code}>marketScores</span></td><td className={td}>suburb, state, buyerScore, sellerScore, computedAt, stale</td><td className={td}>Pre-computed suburb scores</td></tr>
              <tr><td className={td}><span className={code}>marketTrends</span></td><td className={td}>suburb, state, monthKey, buyerScore, sellerScore</td><td className={td}>Monthly score snapshots</td></tr>
            </tbody>
          </table>
        </div>
      );

    case 'buyer-score':
      return (
        <div className={prose}>
          <p>The Buyer Score (0-100) measures buyer demand intensity for a suburb.</p>
          <p className={heading}>Signals &amp; Weights</p>
          <table className={table}>
            <thead><tr><th className={th}>Signal</th><th className={th}>Weight</th><th className={th}>Max</th><th className={th}>Description</th></tr></thead>
            <tbody>
              <tr><td className={td}>Opinions count</td><td className={td}>20%</td><td className={td}>50</td><td className={td}>Total opinions across all properties</td></tr>
              <tr><td className={td}>Serious buyers</td><td className={td}>35%</td><td className={td}>20</td><td className={td}>Opinions where serious == true</td></tr>
              <tr><td className={td}>Likes</td><td className={td}>15%</td><td className={td}>100</td><td className={td}>Total likes across all properties</td></tr>
              <tr><td className={td}>Seriousness level</td><td className={td}>20%</td><td className={td}>200</td><td className={td}>Weighted sum: low=1, medium=2, high=3, very high=4</td></tr>
              <tr><td className={td}>Buyer diversity</td><td className={td}>10%</td><td className={td}>1.0</td><td className={td}>FHB vs investor mix ratio</td></tr>
            </tbody>
          </table>
        </div>
      );

    case 'seller-score':
      return (
        <div className={prose}>
          <p>The Seller Score (0-100) measures seller supply activity for a suburb.</p>
          <p className={heading}>Signals &amp; Weights</p>
          <table className={table}>
            <thead><tr><th className={th}>Signal</th><th className={th}>Weight</th><th className={th}>Max</th><th className={th}>Description</th></tr></thead>
            <tbody>
              <tr><td className={td}>Active properties</td><td className={td}>25%</td><td className={td}>30</td><td className={td}>Properties with visibility == true</td></tr>
              <tr><td className={td}>Going to market (30d)</td><td className={td}>30%</td><td className={td}>15</td><td className={td}>gotoMarketGoal within 30 days</td></tr>
              <tr><td className={td}>Going to market (60d)</td><td className={td}>10%</td><td className={td}>15</td><td className={td}>gotoMarketGoal within 60 days</td></tr>
              <tr><td className={td}>Eager sellers</td><td className={td}>20%</td><td className={td}>10</td><td className={td}>{'isEager >= 70'}</td></tr>
              <tr><td className={td}>Listing density</td><td className={td}>15%</td><td className={td}>50</td><td className={td}>Total properties in radius</td></tr>
            </tbody>
          </table>
        </div>
      );

    case 'market-forecast':
      return (
        <div className={prose}>
          <p>The upcoming-to-market forecast identifies properties likely to hit the market within 30 days.</p>
          <p className={heading}>How it works</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Finds properties where <span className={code}>gotoMarketGoal</span> falls within 30 days</li>
            <li>Calculates <strong>median listing price</strong></li>
            <li>Computes a <strong>demand ratio</strong>: median offer / median listing price</li>
          </ul>
        </div>
      );

    case 'score-pipeline':
      return (
        <div className={prose}>
          <p>Scores are pre-computed and cached to avoid expensive real-time calculations.</p>
          <p className={heading}>Collections</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><span className={code}>marketScores</span> — One doc per suburb. Updated daily.</li>
            <li><span className={code}>marketTrends</span> — Monthly snapshots.</li>
          </ul>
          <p className={heading}>Cron Jobs</p>
          <table className={table}>
            <thead><tr><th className={th}>Job</th><th className={th}>Schedule</th><th className={th}>Description</th></tr></thead>
            <tbody>
              <tr><td className={td}>compute-scores</td><td className={td}>Daily (2am)</td><td className={td}>Recomputes all suburb scores</td></tr>
              <tr><td className={td}>compute-trends</td><td className={td}>Monthly</td><td className={td}>Snapshots scores into marketTrends</td></tr>
              <tr><td className={td}>cleanup-stale</td><td className={td}>Every 6h</td><td className={td}>Recomputes stale scores</td></tr>
            </tbody>
          </table>
          <p className={heading}>Invalidation</p>
          <p>Firebase triggers mark suburb scores as <span className={code}>stale: true</span>. The cleanup cron recomputes only stale entries.</p>
        </div>
      );

    case 'api-endpoints':
      return (
        <div className={prose}>
          <p>All v1 endpoints require <span className={code}>x-api-key</span> header.</p>
          <table className={table}>
            <thead><tr><th className={th}>Endpoint</th><th className={th}>Method</th><th className={th}>Description</th></tr></thead>
            <tbody>
              <tr><td className={td}><span className={code}>/api/v1/buyer-score</span></td><td className={td}>GET</td><td className={td}>Buyer demand score (0-100)</td></tr>
              <tr><td className={td}><span className={code}>/api/v1/seller-score</span></td><td className={td}>GET</td><td className={td}>Seller supply score (0-100)</td></tr>
              <tr><td className={td}><span className={code}>/api/v1/market-forecast</span></td><td className={td}>GET</td><td className={td}>Upcoming properties and demand</td></tr>
              <tr><td className={td}><span className={code}>/api/v1/trending-areas</span></td><td className={td}>GET</td><td className={td}>Top suburbs by score</td></tr>
              <tr><td className={td}><span className={code}>/api/v1/historical-trends</span></td><td className={td}>GET</td><td className={td}>Monthly score history</td></tr>
              <tr><td className={td}><span className={code}>/api/v1/property-insights</span></td><td className={td}>GET</td><td className={td}>Aggregated property data</td></tr>
              <tr><td className={td}><span className={code}>/api/v1/national-overview</span></td><td className={td}>GET</td><td className={td}>National market summary</td></tr>
              <tr><td className={td}><span className={code}>/api/v1/upcoming-to-market</span></td><td className={td}>GET</td><td className={td}>Properties listing soon</td></tr>
            </tbody>
          </table>
        </div>
      );

    case 'tech-stack':
      return (
        <div className={prose}>
          <table className={table}>
            <thead><tr><th className={th}>Layer</th><th className={th}>Technology</th><th className={th}>Purpose</th></tr></thead>
            <tbody>
              <tr><td className={td}>Framework</td><td className={td}>Next.js 15</td><td className={td}>Server/client rendering, API routes</td></tr>
              <tr><td className={td}>UI</td><td className={td}>React 19 + Tailwind 4</td><td className={td}>Components and styling</td></tr>
              <tr><td className={td}>Database</td><td className={td}>Firestore</td><td className={td}>NoSQL with real-time sync</td></tr>
              <tr><td className={td}>Auth</td><td className={td}>Firebase Auth</td><td className={td}>Email/password and social</td></tr>
              <tr><td className={td}>Maps</td><td className={td}>Mapbox GL</td><td className={td}>Maps and geocoding</td></tr>
              <tr><td className={td}>Email</td><td className={td}>Resend</td><td className={td}>Transactional emails</td></tr>
              <tr><td className={td}>Payments</td><td className={td}>Stripe</td><td className={td}>Subscription billing</td></tr>
              <tr><td className={td}>Hosting</td><td className={td}>Vercel</td><td className={td}>Edge deployment</td></tr>
            </tbody>
          </table>
        </div>
      );

    default:
      return <p className="text-sm text-slate-500">Section not found.</p>;
  }
}
