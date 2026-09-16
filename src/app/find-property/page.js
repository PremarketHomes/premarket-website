import { Suspense } from 'react';
import PropertyPageClient from '../components/PropertyPageClient';

// Fetch property data for metadata
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

    // Parse Firestore response format
    const fields = data.fields;
    return {
      title: fields.title?.stringValue || 'Property',
      address: fields.address?.stringValue || '',
      formattedAddress: fields.formattedAddress?.stringValue || '',
      description: fields.description?.stringValue || '',
      imageUrls: fields.imageUrls?.arrayValue?.values?.map(v => v.stringValue) || [],
      showSuburbOnly: fields.showSuburbOnly?.booleanValue || false,
      location: {
        suburb: fields.location?.mapValue?.fields?.suburb?.stringValue || '',
      }
    };
  } catch (error) {
    console.error('Error fetching property for metadata:', error);
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
      description: 'View this property on Premarket \u2014 validate prices with real buyer feedback.',
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

export default function FindPropertyPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center">Loading property...</div>}>
      <PropertyPageClient />
    </Suspense>
  );
}