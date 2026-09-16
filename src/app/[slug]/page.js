import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import PropertyPageClient from '../components/PropertyPageClient';
import { getPropertyForMetadata, buildPropertyMetadata } from '../utils/getPropertyForMetadata';
import { extractPropertyIdFromSlug } from '../utils/propertySlug';

// Clean, human-readable property campaign URL — e.g.
// premarket.homes/59-nautilus-way-af3ollnyi121trucbbwb — living alongside
// the existing premarket.homes/find-property?propertyId=... route, which
// is completely unchanged and keeps working forever for every link
// already sent to a buyer.
//
// This route is additive only. It introduces no new Firestore field, no
// migration/backfill of existing properties, and no change to property
// visibility or permissions: resolving a clean URL still requires
// knowing the property's real, high-entropy 20-character Firestore
// document ID (always the last 20 characters of the slug — see
// utils/propertySlug.js for exactly why a fixed-length suffix is used
// instead of splitting on a delimiter). The human-readable address prefix
// is cosmetic only; it is never validated against the property and adds
// no ability to discover a property without already having the correct
// ID. Once resolved, this renders the exact same PropertyPageClient used
// by the legacy route, via the same already-shipped `previewPropertyId`
// prop the agent-side branding preview uses today (dashboard/branding) —
// same component, same Firestore reads, same price-opinion/interest/
// views/session-tracking logic, same agency branding, for every property.
//
// Next.js gives explicit static routes (e.g. /features, /solutions,
// /login, /join, /listings, /find-property, /v2, ...) priority over this
// catch-all dynamic segment, so this cannot intercept any existing page.
export async function generateMetadata({ params }) {
  const { slug } = await params;
  const propertyId = extractPropertyIdFromSlug(slug);
  if (!propertyId) return {};

  const property = await getPropertyForMetadata(propertyId);
  const canonicalUrl = `https://premarket.homes/${slug}`;
  return buildPropertyMetadata(property, canonicalUrl);
}

export default async function CleanPropertyPage({ params }) {
  const { slug } = await params;
  const propertyId = extractPropertyIdFromSlug(slug);

  // Too short to plausibly be a property URL at all — a real 404, not a
  // "property not found" state inside the property page experience.
  if (!propertyId) {
    notFound();
  }

  return (
    <Suspense fallback={<div className="p-10 text-center">Loading property...</div>}>
      <PropertyPageClient previewPropertyId={propertyId} />
    </Suspense>
  );
}
