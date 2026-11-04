'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Trophy, Eye, EyeOff, ShieldCheck, Loader2 } from 'lucide-react';

const LOGO = 'https://premarketvideos.b-cdn.net/assets/logo.png';
const MIN_LENGTH = 8;

// Field colours are explicit so iPhone dark mode and Safari autofill can't turn typed text white.
const FIELD_CSS = `
  .lead-input { color-scheme: light; -webkit-text-fill-color: #1c1917; caret-color: #1c1917; }
  .lead-input::placeholder { color: #a8a29e; -webkit-text-fill-color: #a8a29e; opacity: 1; }
  .lead-input:-webkit-autofill, .lead-input:-webkit-autofill:hover, .lead-input:-webkit-autofill:focus {
    -webkit-text-fill-color: #1c1917; -webkit-box-shadow: 0 0 0 1000px #ffffff inset; box-shadow: 0 0 0 1000px #ffffff inset; caret-color: #1c1917;
  }
`;

export function InviteShell({ children, sample }) {
  return (
    <div className="min-h-screen bg-[#faf9f7] flex flex-col items-center justify-center px-4 py-10">
      <style>{FIELD_CSS}</style>
      {sample && <div role="note" className="fixed top-0 inset-x-0 bg-[#fdf1df] border-b border-[#f0d9b5] text-[#7a4500] text-xs text-center py-2 px-4">Preview with sample details — nothing here is real or saves anything.</div>}
      <Image src={LOGO} alt="Premarket" width={150} height={38} className="mb-10 h-7 w-auto" unoptimized />
      <div className="max-w-md w-full bg-white border border-stone-200 rounded-md shadow-sm p-7 sm:p-9">{children}</div>
      <p className="mt-6 text-xs text-stone-400">Need help? <a className="underline" href="mailto:knockknock@premarket.homes">knockknock@premarket.homes</a></p>
    </div>
  );
}

const Mark = () => (
  <div className="mb-6">
    <div className="h-px w-10 bg-[#e38100] mb-5" aria-hidden="true" />
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-stone-400"><Trophy className="w-3.5 h-3.5 text-[#e38100]" strokeWidth={1.5} />Leadership Hub</div>
  </div>
);

const PrimaryButton = ({ children, ...props }) => (
  <button {...props} className="w-full py-3 bg-[#e38100] hover:bg-[#cc7400] disabled:opacity-60 text-white text-sm font-semibold tracking-wide rounded-md transition-colors inline-flex items-center justify-center gap-2">{children}</button>
);

const ERRORS = {
  invalid: ['This invitation isn’t valid', 'The link may have been mistyped or copied incompletely. Open the button in your invitation email again.'],
  expired: ['This invitation has expired', 'Invitations are valid for 7 days. Ask your Premarket contact to send you a new one.'],
  used: ['This invitation has already been used', 'If you’ve already set up your account, sign in. Otherwise use “Forgot password” on the sign-in page.'],
  replaced: ['This invitation was replaced', 'A newer invitation was sent to you. Use the most recent email.'],
  network: ['We couldn’t reach the server', 'Check your connection and try again.'],
};

/**
 * Presentational invitation screen. `view` is one of:
 *   checking | new | existing-signed-out | existing-signed-in | existing-wrong-account | saving | needs-reset | error
 */
export default function InviteView({ view, info = {}, errorKind = 'invalid', formError = '', signedInEmail = '', signInHref = '/login', onSubmitPassword, onAccept, onSignOut, sample = false }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [localError, setLocalError] = useState('');
  const submitting = useRef(false);
  const first = info.firstName || 'there';

  const submit = async (e) => {
    e.preventDefault();
    if (submitting.current) return;
    setLocalError('');
    if (password.length < MIN_LENGTH) return setLocalError(`Please use at least ${MIN_LENGTH} characters.`);
    if (password !== confirm) return setLocalError('The two passwords don’t match.');
    submitting.current = true;
    try { await onSubmitPassword?.(password); } finally { submitting.current = false; }
  };

  let body;
  if (view === 'checking') {
    body = <div className="py-10 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#e38100]" /></div>;
  } else if (view === 'error') {
    const [title, text] = ERRORS[errorKind] || ERRORS.invalid;
    body = (<><Mark /><h1 className="font-serif text-2xl text-stone-900">{title}</h1><p className="mt-3 text-sm text-stone-600">{text}</p><Link href="/login" className="mt-6 inline-block text-sm font-medium text-[#c64500] hover:text-[#a63a00]">Go to sign in</Link></>);
  } else if (view === 'needs-reset') {
    body = (<><Mark /><h1 className="font-serif text-2xl text-stone-900">Your access is ready</h1><p className="mt-3 text-sm text-stone-600">Your account has been created for {info.officeName}. Choose your password using “Forgot password” on the sign-in page, then sign in.</p><Link href="/login" className="mt-6 block"><span className="block w-full py-3 text-center bg-[#e38100] hover:bg-[#cc7400] text-white text-sm font-semibold tracking-wide rounded-md transition-colors">Go to sign in</span></Link></>);
  } else if (view === 'new' || view === 'saving') {
    body = (
      <form onSubmit={submit}>
        <Mark />
        <h1 className="font-serif text-3xl leading-tight text-stone-900">Welcome, {first}</h1>
        <p className="mt-3 text-sm text-stone-600">You’ve been invited to the <b className="font-medium text-stone-900">{info.officeName}</b> Leadership Hub. Choose a password to set up your account.</p>
        <div className="mt-6 rounded-md bg-[#faf9f7] border border-stone-200 px-4 py-3 text-sm"><span className="text-[10px] uppercase tracking-[0.16em] text-stone-400 block">Your login</span><span className="text-stone-900">{info.email}</span></div>
        <label className="block mt-5 text-[10px] uppercase tracking-[0.16em] text-stone-400">Password</label>
        <div className="relative mt-1.5">
          <input type={showPw ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="lead-input w-full rounded-md border border-stone-200 bg-white px-3.5 py-3 pr-11 text-sm focus:outline-none focus:border-[#e38100]" placeholder={`At least ${MIN_LENGTH} characters`} />
          <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700">{showPw ? <EyeOff className="w-4 h-4" strokeWidth={1.5} /> : <Eye className="w-4 h-4" strokeWidth={1.5} />}</button>
        </div>
        <label className="block mt-4 text-[10px] uppercase tracking-[0.16em] text-stone-400">Confirm password</label>
        <input type={showPw ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="lead-input mt-1.5 w-full rounded-md border border-stone-200 bg-white px-3.5 py-3 text-sm focus:outline-none focus:border-[#e38100]" />
        {(localError || formError) && <p role="alert" className="mt-3 text-sm text-red-600">{localError || formError}</p>}
        <div className="mt-6"><PrimaryButton type="submit" disabled={view === 'saving'}>{view === 'saving' ? <><Loader2 className="w-4 h-4 animate-spin" />Setting up…</> : 'Set up my account'}</PrimaryButton></div>
        <p className="mt-4 flex gap-2 text-xs text-stone-400"><ShieldCheck className="w-4 h-4 shrink-0 text-stone-400" strokeWidth={1.5} />Your password goes straight to our secure sign-in provider; we never see or email it.</p>
      </form>
    );
  } else {
    // existing-account variants
    body = (
      <div>
        <Mark />
        <h1 className="font-serif text-3xl leading-tight text-stone-900">Welcome, {first}</h1>
        <p className="mt-3 text-sm text-stone-600">You’ve been invited to the <b className="font-medium text-stone-900">{info.officeName}</b> Leadership Hub. You already have a Premarket account, so there’s nothing to set up — accepting only adds Hub access. Your account, password and settings stay exactly as they are.</p>
        <div className="mt-6 rounded-md bg-[#faf9f7] border border-stone-200 px-4 py-3 text-sm"><span className="text-[10px] uppercase tracking-[0.16em] text-stone-400 block">Invitation for</span><span className="text-stone-900">{info.email}</span></div>
        {view === 'existing-signed-out' && (<><Link href={signInHref} className="mt-6 block"><span className="block w-full py-3 text-center bg-[#e38100] hover:bg-[#cc7400] text-white text-sm font-semibold tracking-wide rounded-md transition-colors">Sign in to accept</span></Link><p className="mt-3 text-xs text-stone-400">Use the account for {info.email}.</p></>)}
        {view === 'existing-signed-in' && (<div className="mt-6"><PrimaryButton type="button" onClick={onAccept}>Accept invitation</PrimaryButton>{formError && <p role="alert" className="mt-3 text-sm text-red-600">{formError}</p>}<p className="mt-3 text-xs text-stone-400">Signed in as {signedInEmail}.</p></div>)}
        {view === 'existing-wrong-account' && (<div className="mt-6"><p role="alert" className="text-sm text-red-600">You’re signed in as {signedInEmail}, but this invitation is for {info.email}.</p><button type="button" onClick={onSignOut} className="mt-4 w-full py-3 border border-stone-200 hover:border-stone-300 text-stone-700 text-sm font-medium rounded-md transition-colors">Sign out and use {info.email}</button></div>)}
      </div>
    );
  }
  return <InviteShell sample={sample}>{body}</InviteShell>;
}
