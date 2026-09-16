'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import { TABS } from './utils/constants';
import OverviewTab from './components/tabs/OverviewTab';
import UsersTab from './components/tabs/UsersTab';
import PropertiesTab from './components/tabs/PropertiesTab';
import DisplaysTab from './components/tabs/DisplaysTab';
import ApiRequestsTab from './components/tabs/ApiRequestsTab';
import PHIVerificationTab from './components/tabs/PHIVerificationTab';
import DocsAnalyticsTab from './components/tabs/DocsAnalyticsTab';
import DeveloperDocsTab from './components/tabs/DeveloperDocsTab';
import RecipientLinksTab from './components/tabs/RecipientLinksTab';
import CronJobsPanel from './components/CronJobsPanel';

const TAB_META = {
  overview: { title: 'Overview', description: 'Platform health, recent activity, and key metrics at a glance.' },
  users: { title: 'Users', description: 'Manage all registered users, agents, and buyers.' },
  properties: { title: 'Properties', description: 'Browse and manage all property listings on the platform.' },
  displays: { title: 'Displays', description: 'Manage TV display screens and property showcase configurations.' },
  api: { title: 'API Requests', description: 'Review and manage third-party API access requests.' },
  'phi-verification': { title: 'PHI Verification', description: 'Track and calibrate Premarket Health Indicator accuracy.' },
  'docs-analytics': { title: 'Docs Analytics', description: 'Monitor developer documentation usage and engagement.' },
  'dev-docs': { title: 'Developer Docs', description: 'Internal API documentation and integration guides.' },
  cron: { title: 'Cron Jobs', description: 'Manually trigger or monitor scheduled background tasks.' },
  'recipient-links': { title: 'Recipient Links (Phase 2 test)', description: 'Internal-only: create test personalised recipient links and verify attribution. Not the buyer engagement dashboard.' },
};

function AdminContent() {
  const { user, userData } = useAuth();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') || 'overview';
  const meta = TAB_META[activeTab] || TAB_META.overview;

  if (!user) return null;

  const showHeader = activeTab !== 'overview';

  return (
    <>
      {showHeader && (
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900">{meta.title}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{meta.description}</p>
        </div>
      )}
      {activeTab === 'overview' && <OverviewTab user={user} />}
      {activeTab === 'users' && <UsersTab user={user} />}
      {activeTab === 'properties' && <PropertiesTab user={user} />}
      {activeTab === 'displays' && <DisplaysTab user={user} />}
      {activeTab === 'api' && <ApiRequestsTab user={user} />}
      {activeTab === 'phi-verification' && <PHIVerificationTab user={user} />}
      {activeTab === 'docs-analytics' && <DocsAnalyticsTab user={user} userData={userData} />}
      {activeTab === 'dev-docs' && <DeveloperDocsTab />}
      {activeTab === 'cron' && <CronJobsPanel user={user} />}
      {activeTab === 'recipient-links' && <RecipientLinksTab />}
    </>
  );
}

export default function AdminDashboard() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    }>
      <AdminContent />
    </Suspense>
  );
}
