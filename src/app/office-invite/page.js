'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '../firebase/clientApp';
import { useAuth } from '../context/AuthContext';
import { authFetch } from '../utils/authFetch';
import AuthShell from '../components/public-site/AuthShell';
import { AUTH_SUBMIT_CLASS } from '../components/public-site/authFieldStyles';

/**
 * Accept page for an EXISTING Premarket account invited into an
 * office (see officeImportService.js's inviteExistingAgentToOffice).
 * Deliberately separate from /login?activated=1 (brand-new accounts):
 * this agent already has a working login — nothing changes until they
 * explicitly click Accept here, and the accept call itself verifies
 * server-side that the signed-in uid matches who the invite was
 * actually addressed to (recipient-email verification happens there,
 * not here — this page's own "wrong account" detection below is only
 * ever a UX nicety that steers them to the right place; it is never
 * what actually gates acceptance).
 *
 * Every "log in" link on this page carries `?returnTo=` back to this
 * exact invitation (validated by getSafeReturnTo in login/page.js —
 * see safeRedirect.js), so clicking the invite -> logging in -> and
 * landing back here to click "Join" is one continuous flow instead of
 * dropping the agent on their normal dashboard and making them dig
 * the original email back out. Nothing here ever auto-accepts purely
 * because a login or a return-trip happened — acceptance is always
 * the explicit "Join" button click.
 */
export default function OfficeInvitePage() {
  return (
    <Suspense fallback={null}>
      <OfficeInviteContent />
    </Suspense>
  );
}

function OfficeInviteContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [invite, setInvite] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [acceptError, setAcceptError] = useState('');
  const [switchingAccount, setSwitchingAccount] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError('Missing invitation link');
      return;
    }
    fetch(`/api/office-invites/${encodeURIComponent(token)}`)
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) {
          setLoadError(body.error || 'Invitation not found');
          return;
        }
        setInvite(body.invite);
      })
      .catch(() => setLoadError('Failed to load invitation'));
  }, [token]);

  // Never put the raw token in a log line or anywhere analytics could
  // pick it up — this is the one place a full invite URL is built,
  // and it's only ever used as a `returnTo` href, never logged.
  const loginReturnToUrl = token ? `/login?returnTo=${encodeURIComponent(`/office-invite?token=${token}`)}` : '/login';

  const handleAccept = async () => {
    setAccepting(true);
    setAcceptError('');
    try {
      const res = await authFetch(`/api/office-invites/${encodeURIComponent(token)}`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to accept invitation');
      setAccepted(true);
      const officeName = body.officeName || invite?.officeName || '';
      setTimeout(() => router.push(`/dashboard?officeJoined=1&officeName=${encodeURIComponent(officeName)}`), 1500);
    } catch (err) {
      setAcceptError(err.message);
    } finally {
      setAccepting(false);
    }
  };

  const handleSwitchAccount = async () => {
    setSwitchingAccount(true);
    try {
      // Signs out directly (bypassing useAuth().signOut(), which
      // redirects to "/" on its own) so there's exactly one
      // navigation here — straight back to this invite's login link,
      // never a flash through the homepage first.
      await firebaseSignOut(auth);
    } finally {
      router.push(loginReturnToUrl);
    }
  };

  const wrongAccount = !!(user && invite?.targetEmail && user.email?.toLowerCase() !== invite.targetEmail.toLowerCase());

  let body;
  if (loadError) {
    body = <p className="text-slate-500 text-sm">{loadError}</p>;
  } else if (!invite) {
    body = <p className="text-slate-400 text-sm">Loading invitation…</p>;
  } else if (invite.status === 'accepted' || accepted) {
    body = (
      <div className="text-center">
        <p className="text-slate-900 font-semibold mb-2">You're all set</p>
        <p className="text-slate-500 text-sm">You've joined {invite.officeName}. Taking you to your dashboard…</p>
      </div>
    );
  } else if (invite.status === 'revoked') {
    body = <p className="text-slate-500 text-sm">This invitation has been revoked by {invite.officeName}. Contact them if you think this is a mistake.</p>;
  } else if (invite.expired) {
    body = <p className="text-slate-500 text-sm">This invitation has expired. Ask {invite.officeName} to resend it.</p>;
  } else if (authLoading) {
    body = <p className="text-slate-400 text-sm">Checking your session…</p>;
  } else if (!user) {
    body = (
      <div className="text-center space-y-4">
        <p className="text-slate-600 text-sm">
          Log in as <strong>{invite.targetEmail}</strong> and you'll be brought straight back here to accept.
        </p>
        <Link href={loginReturnToUrl} className={AUTH_SUBMIT_CLASS + ' inline-block'}>
          Log In
        </Link>
      </div>
    );
  } else if (wrongAccount) {
    body = (
      <div className="text-center space-y-4">
        <p className="text-slate-600 text-sm">
          You're signed in as <strong>{user.email}</strong>, but this invitation is for <strong>{invite.targetEmail}</strong>.
        </p>
        <button onClick={handleSwitchAccount} disabled={switchingAccount} className={AUTH_SUBMIT_CLASS}>
          {switchingAccount ? 'Switching…' : 'Switch Account'}
        </button>
      </div>
    );
  } else {
    body = (
      <div className="text-center space-y-4">
        <p className="text-slate-600 text-sm">
          You already have a Premarket account. Accepting will connect your account to{' '}
          <strong>{invite.officeName}</strong> and apply their branding to your campaigns — nothing else changes.
        </p>
        {acceptError && <p className="text-red-600 text-sm">{acceptError}</p>}
        <button onClick={handleAccept} disabled={accepting} className={AUTH_SUBMIT_CLASS}>
          {accepting ? 'Joining…' : `Join ${invite.officeName}`}
        </button>
      </div>
    );
  }

  return (
    <AuthShell title="Office Invitation" subtitle={invite ? `From ${invite.officeName}` : undefined}>
      {body}
    </AuthShell>
  );
}
