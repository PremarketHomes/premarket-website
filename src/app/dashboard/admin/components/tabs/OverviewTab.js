'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../../firebase/clientApp';
import {
  Users,
  Home,
  TrendingUp,
  ShieldCheck,
  Clock,
  Eye,
  Building2,
  FileText,
  ChevronRight,
  DollarSign,
  ArrowRight,
} from 'lucide-react';
import StatCard from '../StatCard';
import CronJobsPanel from '../CronJobsPanel';
import SignupsChart from '../charts/SignupsChart';
import PropertyStatusChart from '../charts/PropertyStatusChart';
import { formatDate, getPropertyImage } from '../../utils/formatters';
import { authFetch } from '../../../../utils/authFetch';
import PropertyThumb from '../../../../components/PropertyThumb';

export default function OverviewTab({ user }) {
  const [data, setData] = useState(null);
  const [properties, setProperties] = useState([]);
  const [loadingState, setLoadingState] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [usersRes, propertiesSnap] = await Promise.all([
          authFetch(`/api/admin/users`),
          getDocs(collection(db, 'properties')),
        ]);
        const usersData = await usersRes.json();

        const allProperties = propertiesSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => p.active !== false && p.archived !== true);

        setData(usersData);
        setProperties(allProperties);
      } catch (err) {
        console.error('Overview fetch error:', err);
      } finally {
        setLoadingState(false);
      }
    }
    fetchData();
  }, [user.uid]);

  if (loadingState) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    );
  }

  const users = data?.users || [];
  const activeCampaigns = properties.filter((p) => p.visibility === true).length;
  const apiApproved = users.filter((u) => u.apiAccess?.status === 'approved').length;
  const apiPending = users.filter((u) => u.apiAccess?.status === 'pending').length;
  const totalViews = properties.reduce((sum, p) => sum + (p.stats?.views || 0), 0);
  const agentCount = users.filter((u) => u.isAgent).length;
  const buyerCount = users.filter((u) => u.isBuyer).length;

  // Recent signups (last 10)
  const recentUsers = [...users]
    .sort((a, b) => {
      const aTime = a.createdAt?.seconds || a.createdAt?._seconds || 0;
      const bTime = b.createdAt?.seconds || b.createdAt?._seconds || 0;
      return bTime - aTime;
    })
    .slice(0, 10);

  // Recent properties (last 10)
  const recentProperties = [...properties]
    .sort((a, b) => {
      const aTime = a.createdAt?.seconds || a.createdAt?._seconds || 0;
      const bTime = b.createdAt?.seconds || b.createdAt?._seconds || 0;
      return bTime - aTime;
    })
    .slice(0, 10);

  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900">Overview</h1>
        <p className="text-sm text-slate-500 mt-0.5">{today}</p>
      </div>

      {/* Quick status pills */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">
          <Users className="w-3 h-3" />
          {users.length} total users
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">
          <Home className="w-3 h-3" />
          {activeCampaigns} live campaigns
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-50 text-purple-700 text-xs font-medium">
          {agentCount} agents / {buyerCount} buyers
        </span>
        {apiPending > 0 && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">
            <Clock className="w-3 h-3" />
            {apiPending} API pending
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Total Users" value={users.length} icon={Users} color="blue" />
        <StatCard label="Total Properties" value={properties.length} icon={Home} color="purple" />
        <StatCard label="Active Campaigns" value={activeCampaigns} icon={TrendingUp} color="emerald" />
        <StatCard label="Total Views" value={totalViews.toLocaleString()} icon={Eye} color="slate" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SignupsChart users={users} />
        <PropertyStatusChart properties={properties} />
      </div>

      {/* Invoicing card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center text-orange-600 flex-shrink-0">
            <DollarSign className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">Invoicing & Billing</h3>
            <p className="text-sm text-slate-500 mt-1">
              Manage monthly agency billing, view invoice run history, configure pricing tiers, and check Xero integration status.
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <div className="text-xs text-slate-500">
                <span className="font-semibold text-slate-700">{agentCount}</span> billable agents
              </div>
              <span className="text-slate-300">|</span>
              <div className="text-xs text-slate-500">
                <span className="font-semibold text-slate-700">{properties.length}</span> active properties
              </div>
            </div>
          </div>
          <Link
            href="/dashboard/admin/invoicing"
            className="flex items-center gap-1.5 px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 transition-colors flex-shrink-0"
          >
            Open
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Manual Cron Triggers */}
      <CronJobsPanel user={user} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Signups */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-3 bg-slate-50 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-600">Recent Signups</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {recentUsers.map((u) => (
              <Link key={u.id} href={`/dashboard/admin/users/${u.id}`} className="px-6 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors">
                <div className="w-8 h-8 bg-gradient-to-br from-orange-400 to-amber-500 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
                  {(u.firstName?.[0] || u.email?.[0] || '?').toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {[u.firstName, u.lastName].filter(Boolean).join(' ') || 'No name'}
                  </p>
                  <p className="text-xs text-slate-500 truncate">{u.email}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {u.pro && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-orange-100 text-orange-700">PRO</span>
                  )}
                  {u.isAgent && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-blue-100 text-blue-700">AGENT</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Recent Properties */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-3 bg-slate-50 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-600">Recent Properties</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {recentProperties.map((p) => (
              <Link key={p.id} href={`/dashboard/property/${p.id}`} className="px-6 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors">
                <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {getPropertyImage(p) ? (
                    <PropertyThumb src={getPropertyImage(p)} width={40} height={40} className="w-full h-full object-cover" />
                  ) : (
                    <Building2 className="w-4 h-4 text-slate-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {p.address || p.formattedAddress || 'No address'}
                  </p>
                  <p className="text-xs text-slate-500">{p.price || '--'}</p>
                </div>
                <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full flex-shrink-0 ${
                  p.visibility ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  {p.visibility ? 'Public' : 'Private'}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
