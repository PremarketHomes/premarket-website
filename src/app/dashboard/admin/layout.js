'use client';

import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import { isBuyerOnly } from '../../utils/roles';
import { ToastProvider } from './components/ToastProvider';
import { AdminSidebar, MobileTopBarSpacer } from './components/AdminSidebar';
import { loginUrlForCurrentPage } from '../../utils/loginRedirect';

function AdminShell({ children }) {
  const { user, userData, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(loginUrlForCurrentPage());
      return;
    }
    if (!loading && userData && isBuyerOnly(userData)) {
      router.push('/buyer-dashboard');
      return;
    }
    if (!loading && userData && userData.superAdmin !== true) {
      router.push('/dashboard');
    }
  }, [user, userData, loading, router]);

  if (loading || !user || userData?.superAdmin !== true) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-50">
      <Suspense>
        <AdminSidebar />
      </Suspense>
      <main className="flex-1 min-w-0">
        <MobileTopBarSpacer />
        <div className="px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}

export default function AdminLayout({ children }) {
  return (
    <ToastProvider>
      <AdminShell>{children}</AdminShell>
    </ToastProvider>
  );
}
