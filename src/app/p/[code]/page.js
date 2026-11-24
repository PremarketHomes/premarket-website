import { Suspense, cache } from 'react';
import { notFound } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import PropertyPageClient from '../../components/PropertyPageClient';
import { adminDb } from '../../firebase/adminApp';
import { existingPropNumber, linkedPropertyId } from '../../api/services/shortLinkService';
import { normalizePropSlug, normalizeShortCode, propLinkUrl } from '../../utils/shortLinks';
import { getProperty, propertyMetadata } from '../../find-property/propertyPage';

/**
 * A campaign's buyer page at its short address (see utils/shortLinks.js):
 *   premarket.homes/prop4827319056   the campaign's link. next.config.mjs rewrites (never redirects) /prop{number} to
 *                                    this page, so /prop4827319056 is what stays in the address bar.
 *   premarket.homes/p/x7k2m9q        legacy short links, still valid.
 *
 * Renders the buyer page right here, with no redirect, so the short address is what stays in the address bar, in the
 * phone's Share button and in anything copied from the page. It is the very same page as the full link
 * (/find-property?propertyId=..., unchanged): same component, same data, same link-preview card, and the same view
 * counting, scanner filtering, anonymous price opinions, separate registrations, iPad mode (?mode=ipad) and handling
 * of private and archived campaigns. A link we don't know, or whose campaign was deleted, gets the not-found page (404).
 */
export const dynamic = 'force-dynamic';

// Errors are never cached by unstable_cache, so throwing this keeps a miss out of the cache.
class NotLinked extends Error {}

// A link's campaign never changes once created, so a FOUND mapping is cached (Next's data cache, shared by every
// visitor): a repeat visit costs no database read. Unknown links are not cached (a number may be created a moment later).
const cachedPropertyId = unstable_cache(async (kind, value) => {
  const propertyId = await linkedPropertyId(adminDb, kind, value);
  if (!propertyId) throw new NotLinked();
  return propertyId;
}, ['campaign-link-target-v1'], { revalidate: 86400 });

// Same for "which prop number does this campaign have" (used to point a legacy /p/ page's canonical at the prop link).
const cachedPropNumber = unstable_cache(async (propertyId) => {
  const number = await existingPropNumber(adminDb, propertyId);
  if (!number) throw new NotLinked();
  return number;
}, ['campaign-prop-number-v1'], { revalidate: 86400 });

const orNull = (promise) => promise.catch((err) => { if (err instanceof NotLinked) return null; throw err; });

// One lookup per request, shared by the metadata and the page.
const campaignFor = cache(async (slug) => {
  const number = normalizePropSlug(slug);
  const code = number ? null : normalizeShortCode(slug);
  if (!number && !code) return null; // malformed: no database read at all

  const propertyId = await orNull(cachedPropertyId(number ? 'prop' : 'short', number || code));
  if (!propertyId) return null;

  // The public, 60-second-cached read the full link uses; it also seeds the page. Only if it comes back empty is the
  // campaign checked directly, so that a deleted campaign is "not found" but a momentary hiccup never is.
  const property = await getProperty(propertyId);
  if (!property && !(await adminDb.collection('properties').doc(propertyId).get()).exists) return null;

  const propNumber = number || (await orNull(cachedPropNumber(propertyId)).catch(() => null));
  return { propertyId, property, canonical: propNumber ? propLinkUrl(propNumber) : null };
});

export async function generateMetadata({ params }) {
  const { code } = await params;
  const campaign = await campaignFor(code);
  if (!campaign) return { title: { absolute: 'Link not found | Premarket' }, robots: { index: false } };
  return propertyMetadata(campaign.property, { canonical: campaign.canonical });
}

export default async function CampaignLinkPage({ params }) {
  const { code } = await params;
  const campaign = await campaignFor(code);
  if (!campaign) notFound();

  return (
    <Suspense fallback={<div className="p-10 text-center">Loading property...</div>}>
      <PropertyPageClient propertyId={campaign.propertyId} initialProperty={campaign.property} />
    </Suspense>
  );
}
