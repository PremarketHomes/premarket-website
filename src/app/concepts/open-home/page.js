import { Suspense } from 'react';
import ConceptGate from './_components/ConceptGate';
import PitchPage from './_components/PitchPage';

// The presentation page for the Open Home Experience concept. Private (see ConceptGate), never indexed or linked.
export default function OpenHomeConceptPage() {
  return (
    <ConceptGate requireAdmin={process.env.VERCEL_ENV === 'production'}>
      <Suspense fallback={null}>
        <PitchPage />
      </Suspense>
    </ConceptGate>
  );
}
