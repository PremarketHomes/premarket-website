import { notFound } from 'next/navigation';
import AgentProfileView from '../../../AgentProfileView';
import { sampleProfile } from '../../../fixture';

/** Preview-only agent profile with INVENTED sample data. 404 in production; see ../../page.js. */
export const dynamic = 'force-dynamic';

export default async function LeadershipPreviewAgentPage({ params, searchParams }) {
  const env = process.env.VERCEL_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'development');
  if (env === 'production') notFound();
  const { uid } = await params;
  const { as } = await searchParams;
  const profile = sampleProfile(String(as || '').toLowerCase() === 'trevor' ? 'Trevor' : 'David', uid);
  if (!profile) notFound();
  return <AgentProfileView data={profile} sample hubHref={`/dashboard/leadership/preview${as ? `?as=${encodeURIComponent(as)}` : ''}`} />;
}
