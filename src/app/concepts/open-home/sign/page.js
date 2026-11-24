import { Suspense } from 'react';
import ConceptGate from '../_components/ConceptGate';
import SignClient from './SignClient';

export default function OpenHomeSignPage() {
  return (
    <ConceptGate requireAdmin={process.env.VERCEL_ENV === 'production'}>
      <Suspense fallback={null}>
        <SignClient />
      </Suspense>
    </ConceptGate>
  );
}
