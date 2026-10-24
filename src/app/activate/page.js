'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { confirmPasswordReset, signInWithEmailAndPassword, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '../firebase/clientApp';
import { authFetch } from '../utils/authFetch';

const LOGO = 'https://premarketvideos.b-cdn.net/assets/logo.png';
const MIN_LENGTH = 8;
const STALE_CODE_ERRORS = ['auth/invalid-action-code', 'auth/expired-action-code'];

// Field colours are set explicitly so iPhone dark mode and Safari autofill can't turn the
// typed text white on the white card.
const FIELD_CSS = `
  .activate-input { color-scheme: light; -webkit-text-fill-color: #0f172a; caret-color: #0f172a; }
  .activate-input::placeholder { color: #94a3b8; -webkit-text-fill-color: #94a3b8; opacity: 1; }
  .activate-input:-webkit-autofill,
  .activate-input:-webkit-autofill:hover,
  .activate-input:-webkit-autofill:focus {
    -webkit-text-fill-color: #0f172a;
    -webkit-box-shadow: 0 0 0 1000px #ffffff inset;
    box-shadow: 0 0 0 1000px #ffffff inset;
    caret-color: #0f172a;
  }
`;

/**
 * Landing page for the activation button in an office invitation email.
 *
 * Opening this page changes nothing: it only checks the link and greets the agent. Email
 * security scanners, iOS link previews and prefetchers open links before the agent taps
 * them, and the old page minted a one-use Firebase password link on load — so a preview
 * could replace the very link the agent was about to use, landing them on Firebase's
 * generic "expired or already used" screen. Now a fresh Firebase code is only requested
 * when the agent submits their password, and if Firebase ever rejects it we quietly
 * request another instead of showing an error. The password goes from the browser straight
 * to Firebase (never through our servers), exactly as on Firebase's own page.
 */
async function postActivation(token, intent) {
  const res = await fetch('/api/office-activation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(intent ? { token, intent } : { token }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || 'This activation link is not valid.');
    err.status = res.status;
    throw err;
  }
  return body;
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-10">
      <Image src={LOGO} alt="Premarket" width={150} height={38} className="mb-8" unoptimized />
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-7 sm:p-9">{children}</div>
      <p className="mt-6 text-xs text-slate-400">
        Need help? <a className="underline" href="mailto:knockknock@premarket.homes">knockknock@premarket.homes</a>
      </p>
    </div>
  );
}

function friendlyAuthError(err) {
  if (err?.code === 'auth/weak-password') return 'Please choose a stronger password (at least 8 characters).';
  if (err?.code === 'auth/network-request-failed' || err instanceof TypeError) return 'We couldn’t reach the server. Check your connection and try again.';
  if (err?.status === 429) return 'This link has been used too many times. Use “Forgot password” on the sign-in page.';
  return 'We couldn’t finish setting your password. Please try again.';
}

function ActivateInner() {
  const token = useSearchParams().get('t');
  const [state, setState] = useState({ status: 'checking' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [formError, setFormError] = useState('');
  const submitting = useRef(false);

  useEffect(() => {
    if (!token) return setState({ status: 'error', kind: 'invalid' });
    let cancelled = false;
    (async () => {
      try {
        const body = await postActivation(token);
        if (cancelled) return;
        if (body.alreadyActive) return setState({ status: 'active' });
        setState({ status: 'ready', firstName: body.firstName || '', officeName: body.officeName || '' });
      } catch (err) {
        if (cancelled) return;
        if (err.status === 410) return setState({ status: 'error', kind: /replaced/i.test(err.message) ? 'replaced' : 'expired' });
        if (err.status === 404 || err.status === 429) return setState({ status: 'error', kind: err.status === 429 ? 'used' : 'invalid' });
        setState({ status: 'error', kind: 'network' });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function setPasswordWithFreshCode() {
    let lastErr;
    // At most two attempts: if the first code is rejected as stale, mint another and retry.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const minted = await postActivation(token, 'continue');
      if (minted.alreadyActive) return { alreadyActive: true };
      try {
        const email = await verifyPasswordResetCode(auth, minted.oobCode);
        await confirmPasswordReset(auth, minted.oobCode, password);
        return { email };
      } catch (err) {
        lastErr = err;
        if (!STALE_CODE_ERRORS.includes(err?.code)) throw err;
      }
    }
    throw lastErr;
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (submitting.current) return; // a double tap must not request two codes
    setFormError('');
    if (password.length < MIN_LENGTH) return setFormError(`Please use at least ${MIN_LENGTH} characters.`);
    if (password !== confirm) return setFormError('The two passwords don’t match.');

    submitting.current = true;
    setState((s) => ({ ...s, status: 'saving' }));
    try {
      const result = await setPasswordWithFreshCode();
      if (result.alreadyActive) return setState({ status: 'active' });
      try {
        await signInWithEmailAndPassword(auth, result.email, password);
        try { await authFetch('/api/offices/activate', { method: 'POST' }); } catch { /* non-blocking, as on the login page */ }
        window.location.assign('/dashboard');
      } catch {
        // Password is set; fall back to the normal sign-in page.
        window.location.assign('/login?activated=1');
      }
    } catch (err) {
      if (err?.status === 404 || err?.status === 410) {
        return setState({ status: 'error', kind: err.status === 410 ? 'expired' : 'invalid' });
      }
      setFormError(STALE_CODE_ERRORS.includes(err?.code)
        ? 'That didn’t go through. Please press the button again.'
        : friendlyAuthError(err));
      setState((s) => ({ ...s, status: 'ready' }));
    } finally {
      submitting.current = false;
    }
  }

  if (state.status === 'checking') {
    return (
      <Shell>
        <div className="text-center" role="status">
          <div className="animate-spin rounded-full h-9 w-9 border-b-4 border-orange-500 mx-auto mb-4" />
          <p className="text-slate-600">Checking your invitation…</p>
        </div>
      </Shell>
    );
  }

  if (state.status === 'active') {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-slate-900 mb-2">Your account is already active</h1>
        <p className="text-slate-600 mb-6">You’re all set — sign in with the password you chose.</p>
        <Link href="/login" className="block text-center w-full px-5 py-3 rounded-xl bg-orange-600 text-white font-semibold">Go to sign in</Link>
      </Shell>
    );
  }

  if (state.status === 'error') {
    const copy = {
      expired: ['This invitation link has expired', 'Invitation links are valid for 14 days. Ask your office administrator to resend your invitation — or set a password right now using “Forgot password” on the sign-in page.'],
      replaced: ['A newer invitation has been sent', 'This link was replaced when your invitation was sent again. Please open the most recent invitation email.'],
      used: ['This link has been used too many times', 'For your security, please use “Forgot password” on the sign-in page to set your password.'],
      network: ['We couldn’t load your invitation', 'Check your connection and try opening the link again.'],
      invalid: ['This invitation link isn’t valid', 'Please open the link from your invitation email again, or ask your office administrator to resend it.'],
    }[state.kind] || ['This invitation link isn’t valid', 'Please ask your office administrator to resend your invitation.'];
    return (
      <Shell>
        <h1 className="text-xl font-bold text-slate-900 mb-2">{copy[0]}</h1>
        <p className="text-slate-600 mb-6">{copy[1]}</p>
        <Link href="/login" className="block text-center w-full px-5 py-3 rounded-xl bg-orange-600 text-white font-semibold">Go to sign in</Link>
      </Shell>
    );
  }

  const saving = state.status === 'saving';
  return (
    <Shell>
      <p className="text-xs font-bold tracking-widest uppercase text-orange-600 mb-2">Account setup</p>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">
        {state.firstName ? `Welcome, ${state.firstName}` : 'Welcome to Premarket'}
      </h1>
      <p className="text-slate-600 mb-6">
        {state.officeName
          ? <>Choose a password to activate your Premarket account with <strong>{state.officeName}</strong>.</>
          : 'Choose a password to activate your Premarket account.'}
      </p>
      <style>{FIELD_CSS}</style>
      <form onSubmit={onSubmit} noValidate>
        <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="new-password">New password</label>
        <input
          id="new-password" name="new-password" placeholder="Choose a password" type={showPw ? 'text' : 'password'} autoComplete="new-password"
          value={password} onChange={(e) => setPassword(e.target.value)} disabled={saving}
          className="activate-input w-full rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 px-4 py-3 text-base mb-4 focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
        <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="confirm-password">Confirm password</label>
        <input
          id="confirm-password" name="confirm-password" placeholder="Re-enter your password" type={showPw ? 'text' : 'password'} autoComplete="new-password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={saving}
          className="activate-input w-full rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 px-4 py-3 text-base mb-3 focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
        <label className="flex items-center gap-2 text-sm text-slate-600 mb-4">
          <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} /> Show password
        </label>
        <p className="text-xs text-slate-500 mb-4">At least {MIN_LENGTH} characters.</p>
        {formError && <p role="alert" className="text-sm text-red-600 mb-4">{formError}</p>}
        <button
          type="submit" disabled={saving}
          className="w-full px-5 py-3.5 rounded-xl bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white font-semibold text-base"
        >
          {saving ? 'Activating…' : 'Activate my account'}
        </button>
      </form>
    </Shell>
  );
}

export default function ActivatePage() {
  return (
    <Suspense fallback={null}>
      <ActivateInner />
    </Suspense>
  );
}
