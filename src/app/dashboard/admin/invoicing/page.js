'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BarChart3, FileText, Settings, Plug, ChevronRight, Receipt, Building2, Users } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { authFetch } from '../../../utils/authFetch';
import InvoicingOverview from './components/InvoicingOverview';
import InvoiceRunsPanel from './components/InvoiceRunsPanel';
import InvoicingSettings from './components/InvoicingSettings';
import ChargesPanel from './components/ChargesPanel';
import BillingContactsPanel from './components/BillingContactsPanel';
import AgencyMembershipsPanel from './components/AgencyMembershipsPanel';

const TABS = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'charges', label: 'Charges', icon: Receipt },
  { key: 'runs', label: 'Invoice Runs', icon: FileText },
  { key: 'billing-contacts', label: 'Billing Contacts', icon: Building2 },
  { key: 'agency-memberships', label: 'Agency Memberships', icon: Users },
  { key: 'settings', label: 'Settings', icon: Settings },
];

function InvoicingPageContent() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState('overview');
  const [xeroConnected, setXeroConnected] = useState(false);
  const [xeroLoading, setXeroLoading] = useState(true);
  const [pricePerListing, setPricePerListing] = useState(null);
  const [xeroError, setXeroError] = useState(null);
  const [pendingContactsCount, setPendingContactsCount] = useState(0);
  const [pendingMembershipsCount, setPendingMembershipsCount] = useState(0);

  useEffect(() => {
    async function checkPendingContacts() {
      if (!user) return;
      try {
        const res = await authFetch('/api/admin/invoicing/billing-contacts');
        const data = await res.json();
        setPendingContactsCount((data.pending || []).length);
      } catch {
        // ignore — the tab itself still loads and shows its own error state
      }
    }
    checkPendingContacts();
  }, [user, activeTab]);

  useEffect(() => {
    async function checkPendingMemberships() {
      if (!user) return;
      try {
        const res = await authFetch('/api/admin/agency-memberships');
        const data = await res.json();
        setPendingMembershipsCount((data.pending || []).length);
      } catch {
        // ignore — the tab itself still loads and shows its own error state
      }
    }
    checkPendingMemberships();
  }, [user, activeTab]);

  // Check Xero connection status + current wholesale price — fetched
  // once here rather than separately in InvoiceRunsPanel, since this
  // is the one place that already loads invoicing settings on mount.
  useEffect(() => {
    async function checkXero() {
      if (!user) return;
      try {
        const res = await authFetch(`/api/admin/invoicing/settings`);
        const data = await res.json();
        setXeroConnected(data.settings?.xeroConnected || false);
        setPricePerListing(data.settings?.pricePerListing ?? null);
      } catch {
        // ignore
      } finally {
        setXeroLoading(false);
      }
    }
    checkXero();
  }, [user]);

  // Handle Xero OAuth callback params — both outcomes, not just success,
  // so a failed connection attempt is never silent (see
  // XERO_ERROR_MESSAGES in InvoicingSettings.js for what each reason means).
  useEffect(() => {
    const xeroStatus = searchParams.get('xero');
    if (xeroStatus === 'connected') {
      setXeroConnected(true);
      setActiveTab('settings');
      router.replace('/dashboard/admin/invoicing', { scroll: false });
    } else if (xeroStatus === 'error') {
      setXeroError(searchParams.get('reason') || 'unknown');
      setActiveTab('settings');
      router.replace('/dashboard/admin/invoicing', { scroll: false });
    }
  }, [searchParams, router]);

  if (!user) return null;

  return (
    <div>
      {/* Breadcrumb + Xero status */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2 text-sm">
          <Link href="/dashboard/admin" className="text-slate-400 hover:text-slate-600 transition-colors">
            Admin
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
          <span className="font-semibold text-slate-900">Invoicing</span>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
          xeroConnected
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-slate-100 text-slate-500'
        }`}>
          <Plug className="w-3 h-3" />
          {xeroLoading ? '...' : xeroConnected ? 'Xero Connected' : 'Xero Not Connected'}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="bg-white rounded-xl border border-slate-200 mb-6">
        <div className="flex gap-1 px-4 border-b border-slate-200">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-orange-500 text-orange-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {tab.key === 'billing-contacts' && pendingContactsCount > 0 && (
                  <span className="bg-amber-100 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                    {pendingContactsCount}
                  </span>
                )}
                {tab.key === 'agency-memberships' && pendingMembershipsCount > 0 && (
                  <span className="bg-amber-100 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                    {pendingMembershipsCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      {activeTab === 'overview' && <InvoicingOverview user={user} />}
      {activeTab === 'charges' && <ChargesPanel />}
      {activeTab === 'runs' && <InvoiceRunsPanel user={user} pricePerListing={pricePerListing} />}
      {activeTab === 'billing-contacts' && <BillingContactsPanel />}
      {activeTab === 'agency-memberships' && <AgencyMembershipsPanel />}
      {activeTab === 'settings' && (
        <InvoicingSettings
          user={user}
          xeroConnected={xeroConnected}
          xeroError={xeroError}
          onXeroDisconnected={() => setXeroConnected(false)}
        />
      )}
    </div>
  );
}

export default function InvoicingPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    }>
      <InvoicingPageContent />
    </Suspense>
  );
}
