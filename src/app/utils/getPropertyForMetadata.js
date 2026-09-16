// Shared server-side property fetch + metadata builder, used by both the
// legacy /find-property?propertyId= route and the clean /[slug] route so
// their generated <title>/<meta>/OG/Twitter tags stay identical and only
// diverge in canonical URL. Extracted from the pre-existing
// find-property/page.js implementation — behavior is unchanged for that
// route, just no longer duplicated.
//
// Uses the public Firestore REST API with the project's public web API
// key (not a secret — Firebase web API keys are meant to be client-
// exposed and are protected by Firestore security rules, not by key
// secrecy). Same pattern already used here before this file existed.
export async function getPropertyForMetadata(propertyId) {
  if (!propertyId) return null;

  try {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/premarket-homes/databases/(default)/documents/properties/${propertyId}?key=AIzaSyDuUEafvE_UXtNEpU--AnkO6bh_8l5j0I8`,
      { next: { revalidate: 60 } } // Cache for 60 seconds
    );

    if (!response.ok) return null;

    const data = await response.json();
    if (!data.fields) return null;

    const fields = data.fields;
    return {
      title: fields.title?.stringValue || 'Property',
      address: fields.address?.stringValue || '',
      formattedAddress: fields.formattedAddress?.stringValue || '',
      description: fields.description?.stringValue || '',
      imageUrls: fields.imageUrls?.arrayValue?.values?.map((v) => v.stringValue) || [],
      showSuburbOnly: fields.showSuburbOnly?.booleanValue || false,
      location: {
        suburb: fields.location?.mapValue?.fields?.suburb?.stringValue || '',
      },
    };
  } catch (error) {
    console.error('Error fetching property for metadata:', error);
    return null;
  }
}

// Builds the shared Next.js metadata object for a property campaign page.
// `canonicalUrl` lets each route point at its own preferred canonical
// (see propertySlug.js / the two route files for why). Both property
// routes are intentionally noindex,nofollow — Premarket campaigns are
// private, link-distributed pages, not public listings meant for search
// discovery, matching the site-wide positioning established in the public
// site redesign.
export function buildPropertyMetadata(property, canonicalUrl) {
  if (!property) {
    return {
      title: 'Property | Premarket',
      description: 'View this property on Premarket — validate prices with real buyer feedback.',
      robots: { index: false, follow: false },
    };
  }

  const displayAddress = property.showSuburbOnly
    ? property.address || property.location?.suburb || 'Australia'
    : property.formattedAddress || property.address;

  const title = property.title || 'Pre-Market Property';
  const description =
    property.description?.slice(0, 160) ||
    `Property in ${displayAddress} on Premarket. See real buyer price opinions and validate the price with genuine feedback.`;
  const heroImage = property.imageUrls?.[0] || 'https://premarketvideos.b-cdn.net/assets/logo.png';

  return {
    title: `${title} | Premarket`,
    description,
    alternates: canonicalUrl ? { canonical: canonicalUrl } : undefined,
    robots: { index: false, follow: false },
    openGraph: {
      title: `${title} | Premarket`,
      description,
      images: [
        {
          url: heroImage,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
      type: 'website',
      siteName: 'Premarket',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | Premarket`,
      description,
      images: [heroImage],
    },
  };
}
