import { Suspense } from 'react';
import ConceptGate from '../_components/ConceptGate';
import SignClient from './SignClient';
import { requireAdminSignIn } from '../_lib/shareAccess';

export default async function OpenHomeSignPage() {
  return (
    <ConceptGate requireAdmin={await requireAdminSignIn()}>
      <Suspense fallback={null}>
        <SignClient />
      </Suspense>
    </ConceptGate>
  );
}
