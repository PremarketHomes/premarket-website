'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../context/AuthContext';
import { authFetch } from '../utils/authFetch';
import AuthShell from '../components/public-site/AuthShell';
import { AUTH_SUBMIT_CLASS, AUTH_LINK_CLASS } from '../components/public-site/authFieldStyles';

/**
 * Accept page for an EXISTING Premarket account invited into an
 * office (see officeImportService.js's inviteExistingAgentToOffice).
 * Deliberately separate from /login?activated=1 (brand-new accounts):
 * this agent already has a working login — nothing changes until they
 * explicitly click Accept here, and the accept call itself verifies
 * server-side that the signed-in uid matches who the invite was
 * actually addressed to.
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

  const handleAccept = async () => {
    setAccepting(true);
    setAcceptError('');
    try {
      const res = await authFetch(`/api/office-invites/${encodeURIComponent(token)}`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to accept invitation');
      setAccepted(true);
      setTimeout(() => router.push('/dashboard'), 1500);
    } catch (err) {
      setAcceptError(err.message);
    } finally {
      setAccepting(false);
    }
  };

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
  } else if (authLoading) {
    body = <p className="text-slate-400 text-sm">Checking your session…</p>;
  } else if (!user) {
    body = (
      <div className="text-center space-y-4">
        <p className="text-slate-600 text-sm">
          Log in as <strong>{invite.targetEmail}</strong>, then come back to this link to accept.
        </p>
        <Link href="/login" className={AUTH_SUBMIT_CLASS + ' inline-block'}>
          Log In
        </Link>
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
