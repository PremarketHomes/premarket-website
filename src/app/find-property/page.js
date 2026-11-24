import { Suspense } from 'react';
import PropertyPageClient from '../components/PropertyPageClient';
import { getProperty, propertyMetadata } from './propertyPage';

// The full buyer link. Data loading and metadata live in ./propertyPage.js, shared with the short link /p/{code}.

export async function generateMetadata({ searchParams }) {
  const params = await searchParams;
  const propertyId = params?.propertyId;
  return propertyMetadata(await getProperty(propertyId));
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
