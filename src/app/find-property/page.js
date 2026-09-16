import { Suspense } from 'react';
import PropertyPageClient from '../components/PropertyPageClient';
import { getPropertyForMetadata, buildPropertyMetadata } from '../utils/getPropertyForMetadata';

// This route is unchanged and must keep working forever — every property
// link already sent to a buyer uses this exact URL shape
// (?propertyId=...). A newer, human-readable /[slug] route exists
// alongside this one for new shares; it resolves to the same
// PropertyPageClient rendering path via the same propertyId, it does not
// replace this route. See src/app/[slug]/page.js and
// src/app/utils/propertySlug.js.
export async function generateMetadata({ searchParams }) {
  const params = await searchParams;
  const propertyId = params?.propertyId;
  const property = await getPropertyForMetadata(propertyId);
  const canonicalUrl = propertyId
    ? `https://premarket.homes/find-property?propertyId=${propertyId}`
    : undefined;
  return buildPropertyMetadata(property, canonicalUrl);
}

export default function FindPropertyPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center">Loading property...</div>}>
      <PropertyPageClient />
    </Suspense>
  );
}
