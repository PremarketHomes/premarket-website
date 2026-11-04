'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../../../../context/AuthContext';
import { useRequireAgent } from '../../../../hooks/useRequireAgent';
import { authFetch } from '../../../../utils/authFetch';
import AgentProfileView from '../../AgentProfileView';

/** Agent coaching profile. All data comes from /api/leadership/agents/{uid}, authorised server-side. */
export default function LeadershipAgentPage({ params }) {
  useRequireAgent();
  const { uid: agentUid } = use(params);
  const { user, loading: authLoading, signOut } = useAuth();
  const [state, setState] = useState({ status: 'loading', data: null });
  const uid = user?.uid;

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const res = await authFetch(`/api/leadership/agents/${encodeURIComponent(agentUid)}`);
      if (res.status === 403 || res.status === 404) return setState({ status: 'missing', data: null });
      if (!res.ok) throw new Error('failed');
      setState({ status: 'ready', data: await res.json() });
    } catch {
      setState({ status: 'error', data: null });
    }
  }, [agentUid]);

  useEffect(() => {
    if (authLoading || !uid) return;
    load();
  }, [authLoading, uid, load]);

  if (state.status === 'ready') return <AgentProfileView data={state.data} onSignOut={signOut} />;
  return (
    <div className="min-h-screen bg-[#faf9f7] flex items-center justify-center px-4 text-center">
      {state.status === 'missing' ? (
        <div><p className="text-stone-700 mb-4">That agent isn't available.</p><Link href="/dashboard/leadership" className="text-[#c64500] text-sm font-medium">Back to the Leadership Hub</Link></div>
      ) : state.status === 'error' ? (
        <div><p className="text-stone-700 mb-4">We couldn't load this profile right now.</p><button onClick={load} className="px-5 py-2.5 rounded-md bg-[#e38100] hover:bg-[#cc7400] text-white text-sm font-semibold tracking-wide">Retry</button></div>
      ) : (
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-[#e38100]" />
      )}
    </div>
  );
}
