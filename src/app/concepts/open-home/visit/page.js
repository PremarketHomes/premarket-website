import { Suspense } from 'react';
import VisitClient from './VisitClient';

// The page a buyer's phone opens from the entrance QR (concept demo). Not gated, so any phone can scan the demo sign;
// everything typed stays on that phone (see _lib/demoStorage.js).
export default function OpenHomeVisitPage() {
  return (
    <Suspense fallback={null}>
      <VisitClient />
    </Suspense>
  );
}
