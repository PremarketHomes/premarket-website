'use client';

import { Lock } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { loginUrlForCurrentPage } from '../../../utils/loginRedirect';
import BrandLockup from './BrandLockup';

/**
 * Keeps the concept's presenter pages (pitch, demo, agent dashboard, sign) private.
 *
 * - Production (`requireAdmin`, from VERCEL_ENV on the server): only a signed-in Premarket platform admin
 *   (users.superAdmin, the same flag the admin console uses) sees them. Everyone else gets a neutral private page.
 * - Vercel preview deployments and local development: shown without sign-in, because previews already sit behind
 *   Vercel's own login (Deployment Protection).
 *
 * The buyer phone page (/concepts/open-home/visit) is deliberately NOT gated, so a phone can scan the demo sign. It is
 * demo-only: nothing typed there leaves the phone.
 */
export default function ConceptGate({ requireAdmin, children }) {
  const { user, userData, loading } = useAuth();
  if (!requireAdmin) return children;

  if (loading || (user && !userData)) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50">
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-slate-200 border-t-orange-500" aria-label="Loading" />
      </div>
    );
  }
  if (user && userData?.superAdmin === true) return children;

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 px-6">
      <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="flex justify-center"><BrandLockup height="24px" /></div>
        <span className="mx-auto mt-6 grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-600"><Lock className="h-6 w-6" aria-hidden="true" /></span>
        <h1 className="mt-4 text-xl font-semibold text-slate-900">This page is private</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {user ? 'It isn’t available for this account.' : 'Sign in with an authorised Premarket account to view it.'}
        </p>
        {!user && (
          <a href={loginUrlForCurrentPage()} className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-slate-900 px-6 text-sm font-semibold text-white hover:bg-slate-800">
            Sign in
          </a>
        )}
      </div>
    </div>
  );
}
