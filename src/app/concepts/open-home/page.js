import { Suspense } from 'react';
import ConceptGate from './_components/ConceptGate';
import PitchPage from './_components/PitchPage';
import { requireAdminSignIn } from './_lib/shareAccess';

// The presentation page for the Open Home Experience concept. Private (see ConceptGate and _lib/shareAccess.js):
// platform admins, or anyone who opened the private share link. Never indexed or linked.
export default async function OpenHomeConceptPage() {
  return (
    <ConceptGate requireAdmin={await requireAdminSignIn()}>
      <Suspense fallback={null}>
        <PitchPage />
      </Suspense>
    </ConceptGate>
  );
}
