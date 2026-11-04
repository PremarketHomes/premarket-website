import { notFound } from 'next/navigation';
import LeadershipHubView from '../LeadershipHubView';
import { sampleHub } from '../fixture';

/**
 * Preview-only walkthrough of the Leadership Hub with INVENTED sample data, so the interface can be
 * reviewed before any live leadership permission exists. It does not authenticate anyone, reads no
 * Firestore data and calls no API: it is a 404 in production (VERCEL_ENV === 'production').
 * Real data is only ever reachable through /dashboard/leadership, which the server authorises.
 */
export const dynamic = 'force-dynamic';

export default async function LeadershipPreviewPage({ searchParams }) {
  const env = process.env.VERCEL_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'development');
  if (env === 'production') notFound();
  const { as } = await searchParams;
  const name = String(as || '').toLowerCase() === 'trevor' ? 'Trevor' : 'David';
  return <LeadershipHubView data={sampleHub(name)} sample agentBase="/dashboard/leadership/preview/agent" agentQuery={`?as=${name.toLowerCase()}`} />;
}
