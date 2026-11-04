import { assertNotProduction } from '../guard';
import SampleAdmin from './SampleAdmin';

export const dynamic = 'force-dynamic';

/** Sample-data preview of the superAdmin invitation screen. 404 in production. */
export default function PreviewAdminPage() {
  assertNotProduction();
  return (
    <div className="min-h-screen bg-slate-50 px-4 sm:px-8 py-8">
      <SampleAdmin />
    </div>
  );
}
