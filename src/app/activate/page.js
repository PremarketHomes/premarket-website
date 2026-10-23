'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

/**
 * Landing page for the activation button in an office invitation email.
 * Exchanges the emailed token for a fresh Firebase password-setup link and sends
 * the agent straight there (Firebase's own secure flow sets the password).
 */
function ActivateInner() {
  const token = useSearchParams().get('t');
  const [state, setState] = useState({ status: 'working', message: '' });

  useEffect(() => {
    if (!token) return setState({ status: 'error', message: 'This activation link is not valid.' });
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/office-activation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) return setState({ status: 'error', message: body.error || 'This activation link is not valid.' });
        if (body.alreadyActive) return setState({ status: 'active', message: '' });
        window.location.assign(body.url);
      } catch {
        if (!cancelled) setState({ status: 'error', message: 'Something went wrong. Please try again.' });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center">
        {state.status === 'working' && (
          <>
            <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500 mx-auto mb-4" />
            <p className="text-slate-700">Setting up your account…</p>
          </>
        )}
        {state.status === 'active' && (
          <>
            <p className="text-slate-900 font-semibold mb-2">Your account is already active.</p>
            <Link href="/login" className="text-orange-600 font-semibold">Sign in</Link>
          </>
        )}
        {state.status === 'error' && (
          <>
            <p className="text-slate-900 font-semibold mb-2">{state.message}</p>
            <p className="text-sm text-slate-500 mb-4">
              You can set your password at any time using “Forgot password” on the sign-in page, or ask your office administrator to resend your invitation.
            </p>
            <Link href="/login" className="inline-block px-5 py-2.5 rounded-lg bg-orange-500 text-white font-semibold">Go to sign in</Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function ActivatePage() {
  return (
    <Suspense fallback={null}>
      <ActivateInner />
    </Suspense>
  );
}
