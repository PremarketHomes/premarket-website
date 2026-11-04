'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { confirmPasswordReset, signInWithEmailAndPassword, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '../firebase/clientApp';
import { useAuth } from '../context/AuthContext';
import { authFetch } from '../utils/authFetch';
import InviteView, { InviteShell } from './InviteView';

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || 'This invitation is not valid.'); err.status = res.status; throw err; }
  return data;
}

/**
 * Landing page for a Leadership Hub invitation email. Opening it changes nothing — it only checks the link.
 * New people choose a password (sent from the browser straight to Firebase); people with an existing Premarket
 * account sign in as themselves and accept, which only adds Hub access.
 */
function InviteInner() {
  const token = useSearchParams().get('t');
  const { user, loading: authLoading, signOut } = useAuth();
  const [state, setState] = useState({ status: 'checking' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return setState({ status: 'error', kind: 'invalid' });
    let cancelled = false;
    post('/api/leadership-activation', { token })
      .then((info) => { if (!cancelled) setState({ status: 'ready', info }); })
      .catch((err) => {
        if (cancelled) return;
        const kind = err.status === 410 ? (/used/i.test(err.message) ? 'used' : /replaced|no longer/i.test(err.message) ? 'replaced' : 'expired') : err.status === 404 ? 'invalid' : 'network';
        setState({ status: 'error', kind });
      });
    return () => { cancelled = true; };
  }, [token]);

  async function onSubmitPassword(password) {
    setFormError('');
    setSaving(true);
    try {
      // The account is created and access granted by this one call; the token is spent with it.
      const minted = await post('/api/leadership-activation', { token, intent: 'continue' });
      if (minted.needsPasswordReset) return setState({ status: 'needs-reset', info: state.info });
      await verifyPasswordResetCode(auth, minted.oobCode);
      await confirmPasswordReset(auth, minted.oobCode, password);
      await signInWithEmailAndPassword(auth, minted.email, password);
      window.location.assign('/dashboard/leadership/profile?welcome=1');
    } catch (err) {
      if (err?.status === 409) setFormError('An account already exists for this email. Please sign in instead.');
      else if (err?.status === 410) setState({ status: 'error', kind: /used/i.test(err.message) ? 'used' : 'expired' });
      else if (err?.code === 'auth/weak-password') setFormError('Please choose a stronger password.');
      else if (err?.code === 'auth/invalid-action-code' || err?.code === 'auth/expired-action-code') setState({ status: 'needs-reset', info: state.info });
      else setFormError('We couldn’t finish setting up your account. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function onAccept() {
    setFormError('');
    try {
      const res = await authFetch('/api/leadership-activation/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || 'We couldn’t accept this invitation.'), { status: res.status });
      window.location.assign('/dashboard/leadership');
    } catch (err) {
      setFormError(err.message || 'We couldn’t accept this invitation. Please try again.');
    }
  }

  if (state.status === 'checking' || (state.status === 'ready' && state.info.mode === 'existing' && authLoading)) return <InviteView view="checking" />;
  if (state.status === 'error') return <InviteView view="error" errorKind={state.kind} />;
  if (state.status === 'needs-reset') return <InviteView view="needs-reset" info={state.info} />;

  const { info } = state;
  if (info.mode === 'new') return <InviteView view={saving ? 'saving' : 'new'} info={info} formError={formError} onSubmitPassword={onSubmitPassword} />;

  const signInHref = `/login?returnTo=${encodeURIComponent(`/leadership-invite?t=${token}`)}`;
  const mine = user?.email && user.email.toLowerCase() === info.email;
  const view = !user ? 'existing-signed-out' : mine ? 'existing-signed-in' : 'existing-wrong-account';
  return <InviteView view={view} info={info} signedInEmail={user?.email || ''} signInHref={signInHref} formError={formError} onAccept={onAccept} onSignOut={signOut} />;
}

export default function LeadershipInvitePage() {
  return (
    <Suspense fallback={<InviteShell><div className="py-10 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#e38100]" /></div></InviteShell>}>
      <InviteInner />
    </Suspense>
  );
}
