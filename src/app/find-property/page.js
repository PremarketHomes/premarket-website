import { Suspense } from 'react';
import PropertyPageClient from '../components/PropertyPageClient';
import { parseFields } from '../utils/firestoreRest';

// Fetch the full property document server-side, via the same public,
// API-key'd Firestore REST read this file already used for Open Graph
// metadata — now reused for that AND to seed the client component's
// initial render (see initialProperty below), instead of fetching the
// whole document and then discarding everything except a handful of
// metadata fields.
//
// This removes the spinner a cold SMS/email click used to show while
// the client refetched the exact same document from scratch — it does
// not change what fetches the document that actually drives views,
// sessions, or opinion-prefill: PropertyPageClient's own effect still
// runs unconditionally right after mount, exactly as before.
async function getProperty(propertyId) {
  if (!propertyId) return null;

  try {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/premarket-homes/databases/(default)/documents/properties/${propertyId}?key=AIzaSyDuUEafvE_UXtNEpU--AnkO6bh_8l5j0I8`,
      { next: { revalidate: 60 } } // Cache for 60 seconds
    );

    if (!response.ok) return null;

    const data = await response.json();
    if (!data.fields) return null;

    return { id: propertyId, ...parseFields(data.fields) };
  } catch (error) {
    console.error('Error fetching property:', error);
    return null;
  }
}

export async function generateMetadata({ searchParams }) {
  const params = await searchParams;
  const propertyId = params?.propertyId;
  const property = await getProperty(propertyId);

  if (!property) {
    return {
      title: 'Property | Premarket',
      description: 'View this property on Premarket — validate prices with real buyer feedback.',
    };
  }

  const displayAddress = property.showSuburbOnly
    ? (property.address || property.location?.suburb || 'Australia')
    : (property.formattedAddress || property.address);

  const title = property.title || 'Pre-Market Property';
  const description = property.description?.slice(0, 160) || `Property in ${displayAddress} on Premarket. See real buyer price opinions and validate the price with genuine feedback.`;
  const heroImage = property.imageUrls?.[0] || 'https://premarketvideos.b-cdn.net/assets/logo.png';

  return {
    title: `${title} | Premarket`,
    description,
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

export default async function FindPropertyPage({ searchParams }) {
  const params = await searchParams;
  const propertyId = params?.propertyId;
  const initialProperty = await getProperty(propertyId);

  return (
    <Suspense fallback={<div className="p-10 text-center">Loading property...</div>}>
      <PropertyPageClient initialProperty={initialProperty} />
    </Suspense>
  );
}
