import Link from 'next/link';
import { assertNotProduction } from '../guard';
import InviteView from '../../../../leadership-invite/InviteView';

export const dynamic = 'force-dynamic';

const INFO = { firstName: 'Sam', email: 'sam@sample.test', officeName: 'Sample Agency', mode: 'new' };
const VIEWS = {
  new: { view: 'new', info: INFO },
  saving: { view: 'saving', info: INFO },
  'existing-signed-out': { view: 'existing-signed-out', info: { ...INFO, mode: 'existing' } },
  'existing-signed-in': { view: 'existing-signed-in', info: { ...INFO, mode: 'existing' }, signedInEmail: 'sam@sample.test' },
  'existing-wrong-account': { view: 'existing-wrong-account', info: { ...INFO, mode: 'existing' }, signedInEmail: 'someone@else.test' },
  expired: { view: 'error', errorKind: 'expired' },
  used: { view: 'error', errorKind: 'used' },
  invalid: { view: 'error', errorKind: 'invalid' },
  'needs-reset': { view: 'needs-reset', info: INFO },
};

/** Sample-data preview of the invitation screen: /dashboard/leadership/preview/invite?state=new|existing-signed-out|… 404 in production. */
export default async function PreviewInvitePage({ searchParams }) {
  assertNotProduction();
  const { state = 'new' } = await searchParams;
  const props = VIEWS[state] || VIEWS.new;
  return (
    <>
      <InviteView {...props} sample />
      <nav aria-label="Preview states" className="fixed bottom-4 inset-x-0 flex flex-wrap justify-center gap-1.5 px-4 text-[11px]">
        {Object.keys(VIEWS).map((k) => (
          <Link key={k} href={`/dashboard/leadership/preview/invite?state=${k}`} className={`px-2.5 py-1 rounded-full border ${k === state ? 'bg-[#e38100] border-[#e38100] text-white' : 'bg-white border-stone-200 text-stone-500 hover:text-stone-900'}`}>{k}</Link>
        ))}
      </nav>
    </>
  );
}
