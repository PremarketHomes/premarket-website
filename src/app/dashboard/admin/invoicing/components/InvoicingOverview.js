'use client';

import { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, TrendingDown, AlertCircle, Building2 } from 'lucide-react';
import RevenueChart from './RevenueChart';
import { authFetch } from '../../../../utils/authFetch';

function StatCard({ label, value, icon: Icon, color, subtext, trend }) {
  const colorClasses = {
    orange: 'bg-orange-50 text-orange-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    red: 'bg-red-50 text-red-600',
    blue: 'bg-blue-50 text-blue-600',
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colorClasses[color] || colorClasses.blue}`}>
          <Icon className="w-4.5 h-4.5" />
        </div>
        {trend !== undefined && trend !== null && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {trend >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-500 mt-1">{label}</p>
      {subtext && <p className="text-[10px] text-slate-400 mt-0.5">{subtext}</p>}
    </div>
  );
}

export default function InvoicingOverview({ user }) {
  const [analytics, setAnalytics] = useState(null);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [analyticsRes, runsRes] = await Promise.all([
          authFetch(`/api/admin/invoicing/analytics?months=12`),
          authFetch(`/api/admin/invoicing/runs`),
        ]);
        const analyticsData = await analyticsRes.json();
        const runsData = await runsRes.json();
        setAnalytics(analyticsData);
        setRuns(runsData.runs || []);
      } catch (err) {
        console.error('Overview fetch error:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [user.uid]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    );
  }

  const monthlyData = analytics?.monthlyData || [];
  const forecast = analytics?.forecast;

  // Calculate summary stats
  const totalRevenue = monthlyData.reduce((sum, m) => sum + m.totalAmount, 0);
  const thisMonth = monthlyData[monthlyData.length - 1];
  const prevMonth = monthlyData[monthlyData.length - 2];
  const outstanding = monthlyData.reduce((sum, m) => sum + m.outstandingAmount, 0);
  const activeAgencies = thisMonth?.agencyCount || 0;

  // Growth percentage
  const revenueGrowth = prevMonth?.totalAmount
    ? Math.round(((thisMonth?.totalAmount || 0) - prevMonth.totalAmount) / prevMonth.totalAmount * 100)
    : null;

  // Outstanding items from runs
  const outstandingRuns = runs.filter((r) => ['sent', 'partial'].includes(r.status));

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Revenue"
          value={`$${totalRevenue.toLocaleString()}`}
          icon={DollarSign}
          color="orange"
          subtext="All time (inc GST)"
        />
        <StatCard
          label="This Month"
          value={`$${(thisMonth?.totalAmount || 0).toLocaleString()}`}
          icon={TrendingUp}
          color="emerald"
          trend={revenueGrowth}
          subtext={thisMonth?.month || '--'}
        />
        <StatCard
          label="Outstanding"
          value={`$${outstanding.toLocaleString()}`}
          icon={AlertCircle}
          color={outstanding > 0 ? 'red' : 'emerald'}
          subtext={`${outstandingRuns.length} unsettled runs`}
        />
        <StatCard
          label="Active Agencies"
          value={activeAgencies}
          icon={Building2}
          color="blue"
          subtext="Current billing period"
        />
      </div>

      {/* Revenue Chart */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Revenue Over Time</h3>
        <RevenueChart data={monthlyData} forecast={forecast} />
        {forecast && (
          <p className="text-xs text-slate-400 mt-2">
            Forecast: ${forecast.forecastAmount?.toLocaleString()} next month
            ({forecast.trend === 'up' ? 'trending up' : forecast.trend === 'down' ? 'trending down' : 'flat'})
          </p>
        )}
      </div>

      {/* Outstanding Invoices */}
      {outstandingRuns.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-3 bg-red-50 border-b border-red-100">
            <h3 className="text-sm font-semibold text-red-700">Outstanding Invoice Runs</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {outstandingRuns.map((run) => {
              const periodStart = run.periodStart?.toDate?.()
                || (run.periodStart?._seconds ? new Date(run.periodStart._seconds * 1000) : new Date(run.periodStart));
              return (
                <div key={run.id} className="px-6 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {periodStart.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}
                    </p>
                    <p className="text-xs text-slate-500">
                      {run.totalAgencies} agencies, {run.totalProperties} properties
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-red-600">
                      ${run.totalAmountInc?.toLocaleString()}
                    </p>
                    <p className="text-[10px] text-slate-400 uppercase font-medium">{run.status}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
