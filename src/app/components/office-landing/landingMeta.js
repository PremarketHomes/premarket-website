// Shared metadata for an office's vendor page and its team variants, so they stay in step.
export function officeLandingMetadata(office, path) {
  const who = office.team ? `${office.team.name} · ${office.name}` : office.name;
  const title = `${who} | Understand your property’s potential`;
  const description =
    `${office.name} has partnered with Premarket so you can explore buyer interest and anonymous pricing opinions before you go to market.`;
  const url = `https://premarket.homes${path}`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    // Shared privately by agents; not intended as a search landing page.
    robots: { index: false, follow: false },
    openGraph: { title, description, url, siteName: office.name, type: 'website', locale: 'en_AU' },
    twitter: { card: 'summary_large_image', title, description },
  };
}
