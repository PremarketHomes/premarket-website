'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import { useRequireAgent } from '../../hooks/useRequireAgent';
import { db } from '../../firebase/clientApp';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import {
  ArrowLeft,
  Contact2,
  Building2,
  Users,
  Home,
  ShoppingCart,
  Search,
  ChevronRight,
  TrendingUp,
  Activity,
  UserCheck,
  Loader2,
} from 'lucide-react';
import { formatDate, formatRelative } from '../../utils/formatters';
import { loginUrlForCurrentPage } from '../../utils/loginRedirect';

const TABS = [
  { key: 'agencies', label: 'Agencies', icon: Building2 },
  { key: 'agents', label: 'Agents', icon: Users },
  { key: 'homeowners', label: 'Homeowners', icon: Home },
  { key: 'buyers', label: 'Buyers', icon: ShoppingCart },
];

const SERIOUSNESS_COLORS = {
  ready_to_buy: 'bg-emerald-100 text-emerald-700',
  very_interested: 'bg-blue-100 text-blue-700',
  interested: 'bg-amber-100 text-amber-700',
  just_browsing: 'bg-slate-100 text-slate-600',
};

const SERIOUSNESS_LABELS = {
  ready_to_buy: 'Ready to Buy',
  very_interested: 'Very Interested',
  interested: 'Interested',
  just_browsing: 'Just Browsing',
};

const INTENT_COLORS = {
  buyer: 'bg-blue-100 text-blue-700',
  seller: 'bg-orange-100 text-orange-700',
  both: 'bg-purple-100 text-purple-700',
  passive: 'bg-slate-100 text-slate-500',
};

const BUYER_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'ready_to_buy', label: 'Ready to Buy' },
  { key: 'very_interested', label: 'Very Interested' },
  { key: 'interested', label: 'Interested' },
  { key: 'just_browsing', label: 'Just Browsing' },
  { key: 'becoming_sellers', label: 'Becoming Sellers' },
];

function scoreColor(score) {
  if (score >= 61) return 'text-emerald-600';
  if (score >= 41) return 'text-amber-600';
  return 'text-red-500';
}

function ScoreBar({ score, className = '' }) {
  const color = score >= 61 ? 'bg-emerald-500' : score >= 41 ? 'bg-amber-500' : 'bg-red-400';
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className={`text-sm font-semibold tabular-nums ${scoreColor(score)}`}>{score}</span>
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden max-w-[60px]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700',
    amber: 'bg-amber-50 text-amber-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    purple: 'bg-purple-50 text-purple-700',
    orange: 'bg-orange-50 text-orange-700',
    slate: 'bg-slate-100 text-slate-700',
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl p-5 ${colors[color] || colors.slate}`}
    >
      <div className="flex items-center justify-between mb-2">
        <Icon className="w-5 h-5 opacity-60" />
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm opacity-70 mt-0.5">{label}</div>
    </motion.div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function CRMDashboard() {
  useRequireAgent();
  const { user, userData, loading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('buyers');
  const [contacts, setContacts] = useState([]);
  const [agentUsers, setAgentUsers] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [buyerFilter, setBuyerFilter] = useState('all');
  const [sortField, setSortField] = useState('lastActivityAt');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    if (!loading && !user) {
      router.replace(loginUrlForCurrentPage());
      return;
    }
    if (!loading && userData && userData.superAdmin !== true) {
      router.push('/dashboard');
    }
  }, [user, userData, loading, router]);

  useEffect(() => {
    if (!user || userData?.superAdmin !== true) return;

    async function fetchData() {
      setLoadingData(true);
      try {
        const [contactsSnap, agentsSnap] = await Promise.all([
          getDocs(collection(db, 'contacts')),
          getDocs(query(collection(db, 'users'), where('agent', '==', true))),
        ]);
        setContacts(contactsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setAgentUsers(agentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Failed to load CRM data:', err);
      }
      setLoadingData(false);
    }
    fetchData();
  }, [user, userData]);

  // ─── Stat computations ──────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const totalContacts = contacts.length;
    const activeBuyers = contacts.filter((c) => c.buyerScore >= 30).length;
    const activeSellers = contacts.filter((c) => c.sellerScore >= 30).length;
    const dualIntent = contacts.filter((c) => c.intentLabel === 'both').length;
    return { totalContacts, activeBuyers, activeSellers, dualIntent };
  }, [contacts]);

  // ─── Sort helper ────────────────────────────────────────────────────────────
  function toggleSort(field) {
    if (sortField === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  function sortedFiltered(list) {
    let filtered = list;

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((c) => {
        const name = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase();
        const email = (c.email || '').toLowerCase();
        return name.includes(q) || email.includes(q);
      });
    }

    // Sort
    return [...filtered].sort((a, b) => {
      let av = a[sortField];
      let bv = b[sortField];
      // Handle Firestore timestamps
      if (av?.toDate) av = av.toDate().getTime();
      if (bv?.toDate) bv = bv.toDate().getTime();
      if (av instanceof Date) av = av.getTime();
      if (bv instanceof Date) bv = bv.getTime();
      av = av ?? 0;
      bv = bv ?? 0;
      return sortDir === 'desc' ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
    });
  }

  if (loading || !user || userData?.superAdmin !== true) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-4">
          <Link href="/dashboard" className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-[#e48900] to-[#c64500] rounded-lg flex items-center justify-center">
              <Contact2 className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">CRM</h1>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex gap-1 overflow-x-auto pb-0 -mb-px scrollbar-hide">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    isActive
                      ? 'border-orange-500 text-orange-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total Contacts" value={stats.totalContacts} icon={Contact2} color="slate" />
          <StatCard label="Active Buyers" value={stats.activeBuyers} icon={ShoppingCart} color="blue" />
          <StatCard label="Active Sellers" value={stats.activeSellers} icon={Home} color="orange" />
          <StatCard label="Dual Intent" value={stats.dualIntent} icon={Activity} color="purple" />
        </div>

        {loadingData ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
          </div>
        ) : (
          <>
            {activeTab === 'agencies' && (
              <AgenciesTab agents={agentUsers} searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
            )}
            {activeTab === 'agents' && (
              <AgentsTab
                agents={agentUsers}
                contacts={contacts}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
              />
            )}
            {activeTab === 'homeowners' && (
              <HomeownersTab
                contacts={contacts}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                sortField={sortField}
                sortDir={sortDir}
                toggleSort={toggleSort}
                sortedFiltered={sortedFiltered}
              />
            )}
            {activeTab === 'buyers' && (
              <BuyersTab
                contacts={contacts}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                buyerFilter={buyerFilter}
                setBuyerFilter={setBuyerFilter}
                sortField={sortField}
                sortDir={sortDir}
                toggleSort={toggleSort}
                sortedFiltered={sortedFiltered}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Search Bar ──────────────────────────────────────────────────────────────

function SearchBar({ value, onChange, placeholder = 'Search by name or email...' }) {
  return (
    <div className="relative mb-4">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400"
      />
    </div>
  );
}

// ─── Sort Header ─────────────────────────────────────────────────────────────

function SortHeader({ label, field, sortField, sortDir, toggleSort, className = '' }) {
  const isActive = sortField === field;
  return (
    <button
      onClick={() => toggleSort(field)}
      className={`text-left text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-700 ${className}`}
    >
      {label}
      {isActive && <span className="ml-1">{sortDir === 'desc' ? '\u2193' : '\u2191'}</span>}
    </button>
  );
}

// ─── Agencies Tab ────────────────────────────────────────────────────────────

function AgenciesTab({ agents, searchQuery, setSearchQuery }) {
  const agencies = useMemo(() => {
    const map = {};
    for (const agent of agents) {
      const company = agent.companyName || 'Independent';
      if (!map[company]) {
        map[company] = { name: company, logo: null, agents: [], joinedAt: null };
      }
      map[company].agents.push(agent);
      if (agent.companyLogo && !map[company].logo) map[company].logo = agent.companyLogo;
      const joined = agent.createdAt?.toDate?.() || (agent.createdAt ? new Date(agent.createdAt) : null);
      if (joined && (!map[company].joinedAt || joined < map[company].joinedAt)) {
        map[company].joinedAt = joined;
      }
    }
    return Object.values(map).sort((a, b) => b.agents.length - a.agents.length);
  }, [agents]);

  const filtered = useMemo(() => {
    if (!searchQuery) return agencies;
    const q = searchQuery.toLowerCase();
    return agencies.filter((a) => a.name.toLowerCase().includes(q));
  }, [agencies, searchQuery]);

  return (
    <>
      <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search agencies..." />
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">Company</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">Agents</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Joined</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((agency) => (
              <tr key={agency.name} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {agency.logo ? (
                      <img src={agency.logo} alt="" className="w-8 h-8 rounded-lg object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                        <Building2 className="w-4 h-4 text-slate-400" />
                      </div>
                    )}
                    <span className="text-sm font-medium text-slate-900">{agency.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-slate-600">{agency.agents.length}</span>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <span className="text-sm text-slate-500">{agency.joinedAt ? formatDate(agency.joinedAt) : '--'}</span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-400">No agencies found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── Agents Tab ──────────────────────────────────────────────────────────────

function AgentsTab({ agents, contacts, searchQuery, setSearchQuery }) {
  const contactsByEmail = useMemo(() => {
    const map = {};
    for (const c of contacts) {
      if (c.email) map[c.email.toLowerCase()] = c;
    }
    return map;
  }, [contacts]);

  const filtered = useMemo(() => {
    let list = agents;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((a) => {
        const name = `${a.firstName || ''} ${a.lastName || ''} ${a.displayName || ''}`.toLowerCase();
        const email = (a.email || '').toLowerCase();
        const company = (a.companyName || '').toLowerCase();
        return name.includes(q) || email.includes(q) || company.includes(q);
      });
    }
    return list;
  }, [agents, searchQuery]);

  return (
    <>
      <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search agents..." />
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">Agent</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 hidden md:table-cell">Agency</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Email</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">Joined</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((agent) => {
              const contact = contactsByEmail[(agent.email || '').toLowerCase()];
              const href = contact ? `/dashboard/crm/${contact.id}` : null;
              const name = agent.displayName || `${agent.firstName || ''} ${agent.lastName || ''}`.trim() || agent.email;
              return (
                <tr
                  key={agent.id}
                  className="border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer"
                  onClick={() => href && (window.location.href = href)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {agent.avatar || agent.photoURL ? (
                        <img src={agent.avatar || agent.photoURL} alt="" className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold">
                          {(name[0] || '?').toUpperCase()}
                        </div>
                      )}
                      <span className="text-sm font-medium text-slate-900">{name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-sm text-slate-600">{agent.companyName || '--'}</span>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className="text-sm text-slate-500">{agent.email || '--'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-slate-500">{formatDate(agent.createdAt)}</span>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">No agents found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── Homeowners Tab ──────────────────────────────────────────────────────────

function HomeownersTab({ contacts, searchQuery, setSearchQuery, sortField, sortDir, toggleSort, sortedFiltered }) {
  const homeowners = useMemo(() => contacts.filter((c) => c.isHomeowner === true), [contacts]);
  const sorted = sortedFiltered(homeowners);

  const eagernessLabel = (level) => {
    if (level === null || level === undefined) return '--';
    if (level <= 0.5) return 'Very Serious';
    if (level <= 1.5) return 'Serious';
    return 'Testing';
  };

  const eagernessColor = (level) => {
    if (level === null || level === undefined) return 'text-slate-400';
    if (level <= 0.5) return 'text-emerald-600';
    if (level <= 1.5) return 'text-amber-600';
    return 'text-slate-500';
  };

  return (
    <>
      <SearchBar value={searchQuery} onChange={setSearchQuery} />
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-4 py-3">
                  <SortHeader label="Name" field="firstName" sortField={sortField} sortDir={sortDir} toggleSort={toggleSort} />
                </th>
                <th className="px-4 py-3 hidden sm:table-cell">
                  <SortHeader label="Email" field="email" sortField={sortField} sortDir={sortDir} toggleSort={toggleSort} />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Properties</th>
                <th className="px-4 py-3">
                  <SortHeader label="Eagerness" field="eagernessLevel" sortField={sortField} sortDir={sortDir} toggleSort={toggleSort} />
                </th>
                <th className="px-4 py-3">
                  <SortHeader label="First Seen" field="firstSeenAt" sortField={sortField} sortDir={sortDir} toggleSort={toggleSort} />
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <Link key={c.id} href={`/dashboard/crm/${c.id}`} className="contents">
                  <tr className="border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer">
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-slate-900">
                        {c.firstName || ''} {c.lastName || ''}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-sm text-slate-500">{c.email || '--'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-slate-600">{c.ownedPropertyIds?.length || 0}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-medium ${eagernessColor(c.eagernessLevel)}`}>
                        {eagernessLabel(c.eagernessLevel)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-slate-500">{formatDate(c.firstSeenAt)}</span>
                    </td>
                  </tr>
                </Link>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">No homeowners found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ─── Buyers Tab ──────────────────────────────────────────────────────────────

function BuyersTab({ contacts, searchQuery, setSearchQuery, buyerFilter, setBuyerFilter, sortField, sortDir, toggleSort, sortedFiltered }) {
  const buyers = useMemo(() => {
    let list = contacts.filter((c) => c.isBuyer === true);
    if (buyerFilter === 'becoming_sellers') {
      list = list.filter((c) => c.sellerScore > 30);
    } else if (buyerFilter !== 'all') {
      list = list.filter((c) => c.seriousnessLevel === buyerFilter);
    }
    return list;
  }, [contacts, buyerFilter]);

  const sorted = sortedFiltered(buyers);

  return (
    <>
      <SearchBar value={searchQuery} onChange={setSearchQuery} />

      {/* Filter Pills */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {BUYER_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setBuyerFilter(f.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              buyerFilter === f.key
                ? 'bg-orange-500 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-4 py-3">
                  <SortHeader label="Name" field="firstName" sortField={sortField} sortDir={sortDir} toggleSort={toggleSort} />
                </th>
                <th className="px-4 py-3 hidden lg:table-cell">
                  <SortHeader label="Email" field="email" sortField={sortField} sortDir={sortDir} toggleSort={toggleSort} />
                </th>
                <th className="px-4 py-3">
                  <SortHeader label="Opinions" field="totalPriceOpinions" sortField={sortField} sortDir={sortDir} toggleSort={toggleSort} />
                </th>
                <th className="px-4 py-3 hidden sm:table-cell">
                  <SortHeader label="Reg. Interest" field="totalRegisteredInterest" sortField={sortField} sortDir={sortDir} toggleSort={toggleSort} />
                </th>
                <th className="px-4 py-3 hidden md:table-cell text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Seriousness</th>
                <th className="px-4 py-3">
                  <SortHeader label="Buyer" field="buyerScore" sortField={sortField} sortDir={sortDir} toggleSort={toggleSort} />
                </th>
                <th className="px-4 py-3 hidden sm:table-cell">
                  <SortHeader label="Seller" field="sellerScore" sortField={sortField} sortDir={sortDir} toggleSort={toggleSort} />
                </th>
                <th className="px-4 py-3 hidden md:table-cell text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Intent</th>
                <th className="px-4 py-3">
                  <SortHeader label="Last Active" field="lastActivityAt" sortField={sortField} sortDir={sortDir} toggleSort={toggleSort} />
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <Link key={c.id} href={`/dashboard/crm/${c.id}`} className="contents">
                  <tr className="border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer">
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-slate-900">
                        {c.firstName || ''} {c.lastName || ''}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-sm text-slate-500 truncate max-w-[180px] block">{c.email || '--'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-slate-700 tabular-nums">{c.totalPriceOpinions}</span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-sm text-slate-700 tabular-nums">{c.totalRegisteredInterest}</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {c.seriousnessLevel ? (
                        <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${SERIOUSNESS_COLORS[c.seriousnessLevel] || 'bg-slate-100 text-slate-500'}`}>
                          {SERIOUSNESS_LABELS[c.seriousnessLevel] || c.seriousnessLevel}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">--</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ScoreBar score={c.buyerScore || 0} />
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <ScoreBar score={c.sellerScore || 0} />
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full capitalize ${INTENT_COLORS[c.intentLabel] || INTENT_COLORS.passive}`}>
                        {c.intentLabel || 'passive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-slate-500">{formatRelative(c.lastActivityAt)}</span>
                    </td>
                  </tr>
                </Link>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-400">No buyers found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
