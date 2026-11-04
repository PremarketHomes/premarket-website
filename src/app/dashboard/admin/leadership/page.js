'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../../../utils/authFetch';
import AdminLeadershipView from './AdminLeadershipView';

async function call(path, body) {
  const res = await authFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { existing: data.existing });
  return data;
}

/** superAdmin only (the admin layout enforces it; every route here re-checks it server-side). */
export default function AdminLeadershipPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/admin/leadership');
      if (!res.ok) throw new Error('failed');
      setData(await res.json());
    } catch { setError('Could not load Leadership Hub access. Please retry.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="py-16 text-center text-stone-600">{error} <button onClick={() => { setError(''); load(); }} className="ml-2 text-[#c64500] font-medium">Retry</button></div>;
  if (!data) return <div className="py-16 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#e38100]" /></div>;

  const wrap = (path) => async (body) => { const out = await call(path, body); await load(); return out; };
  return (
    <AdminLeadershipView
      data={data}
      onInvite={wrap('/api/admin/leadership/invitations')}
      onRevokeInvite={wrap('/api/admin/leadership/invitations/revoke')}
      onRevokeLeader={wrap('/api/admin/leadership/revoke')}
      writesDisabledNote={typeof window !== 'undefined' && window.location.hostname.endsWith('.vercel.app') ? 'This is a Preview deployment, which shares production data. Inviting and revoking are switched off here.' : null}
    />
  );
}
