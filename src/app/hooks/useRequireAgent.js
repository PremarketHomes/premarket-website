'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../context/AuthContext';
import { isBuyerOnly, isLeadershipOnly } from '../utils/roles';
import { loginUrlForCurrentPage } from '../utils/loginRedirect';

/**
 * Hook that redirects buyer-only users off agent-only pages.
 * Call at the top of every /dashboard/* route. A logged-out visitor is sent to
 * /login with the current page as `returnTo`, so they come back to it after signing in.
 */
export function useRequireAgent() {
  const { user, userData, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      // Keep the page they were trying to reach (e.g. an emailed deep link) through login.
      router.replace(loginUrlForCurrentPage());
      return;
    }
    if (isBuyerOnly(userData)) {
      router.replace('/buyer-dashboard');
      return;
    }
    // Leadership-only accounts have no agent dashboard: keep them within the Leadership Hub.
    if (isLeadershipOnly(userData) && !(pathname || '').startsWith('/dashboard/leadership')) {
      router.replace('/dashboard/leadership');
    }
  }, [user, userData, loading, router, pathname]);
}
