// Redesign-era sitemap. Previously only listed 5 URLs and never included
// any of the redesigned /solutions, /features, /premarket, /contact or
// /join pages — this brings the sitemap in line with the actual public
// site structure.
//
// Deliberately excluded:
//   - /features/data-metrics — dormant, noindexed (removed from active
//     marketing this release)
//   - /v2 — now redirects to /, removed from sitemap in a prior round
//   - /join/success, /join/terms — orphaned, unreachable from the real
//     /join flow
//   - /login, /signup — auth entry points, not content pages; indexing
//     them offers no search value and can create a confusing search
//     result (a form instead of content), so they're intentionally left
//     out rather than "blindly added" per instruction
//
// Individual property campaign pages (/find-property?propertyId=...) are
// NOT enumerated here and must not be — Premarket properties are private,
// link-distributed campaigns, not a public directory. Listing them would
// make every pre-market property individually discoverable via Google,
// which directly contradicts the current visibility model.
export default function sitemap() {
  const baseUrl = 'https://premarket.homes';
  const now = new Date();

  return [
    {
      url: baseUrl,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/join`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/listings`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/find-property`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/premarket`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/features`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/solutions`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/solutions/agents`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/solutions/buyers`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/solutions/buyers-agents`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/solutions/home-owners`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/features/reports`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/features/price-opinions`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/features/agent-ipad`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/features/reminders`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${baseUrl}/contact`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];
}
