import { assertNotProduction } from '../guard';
import SampleProfile from './SampleProfile';

export const dynamic = 'force-dynamic';

/** Sample-data preview of the profile step. 404 in production. ?welcome=1 shows the first-time version. */
export default async function PreviewProfilePage({ searchParams }) {
  assertNotProduction();
  const { welcome } = await searchParams;
  return <SampleProfile welcome={welcome === '1'} />;
}
