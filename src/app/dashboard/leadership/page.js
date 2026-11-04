'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import { useRequireAgent } from '../../hooks/useRequireAgent';
import { authFetch } from '../../utils/authFetch';
import LeadershipHubView from './LeadershipHubView';

/**
 * Leadership Hub. All data comes from /api/leadership/hub, which authorises the caller server-side;
 * nothing here (or in the user document) grants access.
 */
export default function LeadershipPage() {
  useRequireAgent();
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();
  const [state, setState] = useState({ status: 'loading', data: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const res = await authFetch('/api/leadership/hub');
      if (res.status === 403) return setState({ status: 'denied', data: null });
      if (!res.ok) throw new Error('failed');
      setState({ status: 'ready', data: await res.json() });
    } catch {
      setState({ status: 'error', data: null });
    }
  }, []);

  const uid = user?.uid;
  useEffect(() => {
    if (authLoading || !uid) return;
    load();
  }, [authLoading, uid, load]);

  useEffect(() => {
    if (state.status === 'denied') router.replace('/dashboard');
  }, [state.status, router]);

  if (state.status === 'ready') return <LeadershipHubView data={state.data} onSignOut={signOut} />;

  return (
    <div className="min-h-screen bg-[#faf9f7] flex items-center justify-center px-4 text-center">
      {state.status === 'error' ? (
        <div>
          <p className="text-stone-700 mb-4">We couldn't load the Leadership Hub right now.</p>
          <button onClick={load} className="px-5 py-2.5 rounded-md bg-[#e38100] hover:bg-[#cc7400] text-white text-sm font-semibold tracking-wide">Retry</button>
        </div>
      ) : (
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-[#e38100]" />
      )}
    </div>
  );
}
