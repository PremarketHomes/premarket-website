import { Suspense } from 'react';
import ConceptGate from '../_components/ConceptGate';
import DemoClient from './DemoClient';
import { requireAdminSignIn } from '../_lib/shareAccess';

export default async function OpenHomeDemoPage() {
  return (
    <ConceptGate requireAdmin={await requireAdminSignIn()}>
      <Suspense fallback={null}>
        <DemoClient />
      </Suspense>
    </ConceptGate>
  );
}
