import { Suspense, cache } from 'react';
import { notFound } from 'next/navigation';
import PropertyPageClient from '../../components/PropertyPageClient';
import { adminDb } from '../../firebase/adminApp';
import { resolveShortCode } from '../../api/services/shortLinkService';
import { normalizeShortCode } from '../../utils/shortLinks';
import { getProperty, propertyMetadata } from '../../find-property/propertyPage';

/**
 * /p/{code}: a campaign's short link (see utils/shortLinks.js).
 *
 * Renders the campaign's buyer page right here, with no redirect, so the short link is what stays in the address bar,
 * in the phone's Share button and in anything copied from the page. It is the very same page as the full link
 * (/find-property?propertyId=..., unchanged): same component, same data, same link-preview card, and the same view
 * counting, scanner filtering, price opinions, registrations, iPad mode (?mode=ipad) and handling of private and
 * archived campaigns. A code we don't know, or whose campaign was deleted, gets the not-found page (404).
 */
export const dynamic = 'force-dynamic';

// One lookup per request, shared by the metadata and the page.
const campaignFor = cache(async (rawCode) => {
  const code = normalizeShortCode(rawCode);
  if (!code) return null;
  const result = await resolveShortCode(adminDb, code);
  return result.status === 'ok' ? result.propertyId : null;
});

export async function generateMetadata({ params }) {
  const { code } = await params;
  const propertyId = await campaignFor(code);
  if (!propertyId) return { title: { absolute: 'Link not found | Premarket' }, robots: { index: false } };
  return propertyMetadata(await getProperty(propertyId));
}

export default async function ShortLinkPage({ params }) {
  const { code } = await params;
  const propertyId = await campaignFor(code);
  if (!propertyId) notFound();
  const initialProperty = await getProperty(propertyId);

  return (
    <Suspense fallback={<div className="p-10 text-center">Loading property...</div>}>
      <PropertyPageClient propertyId={propertyId} initialProperty={initialProperty} />
    </Suspense>
  );
}
