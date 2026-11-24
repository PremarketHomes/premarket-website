import { Suspense } from 'react';
import ConceptGate from '../_components/ConceptGate';
import DemoClient from './DemoClient';

export default function OpenHomeDemoPage() {
  return (
    <ConceptGate requireAdmin={process.env.VERCEL_ENV === 'production'}>
      <Suspense fallback={null}>
        <DemoClient />
      </Suspense>
    </ConceptGate>
  );
}
