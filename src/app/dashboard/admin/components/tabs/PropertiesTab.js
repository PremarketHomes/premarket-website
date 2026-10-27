'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { collection, getDocs, getDoc, doc, query, where } from 'firebase/firestore';
import { db } from '../../../../firebase/clientApp';
import {
  Search,
  Home,
  Building2,
  Eye,
  ExternalLink,
  ChevronRight,
  ArrowRightLeft,
  X,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { formatDate, getPropertyImage } from '../../utils/formatters';
import { authFetch } from '../../../../utils/authFetch';

export default function PropertiesTab({ user }) {
  const router = useRouter();
  const [properties, setProperties] = useState([]);
  const [allUsers, setAllUsers] = useState({});
  const [allAgentDocs, setAllAgentDocs] = useState({});
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('');

  // Selection state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [reassignSearch, setReassignSearch] = useState('');
  const [reassignTargetId, setReassignTargetId] = useState(null);
  const [reassigning, setReassigning] = useState(false);
  const [reassignSuccess, setReassignSuccess] = useState(null);
  const [reassignNotify, setReassignNotify] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setPropertiesLoading(true);
      const [propertiesSnap, usersRes] = await Promise.all([
        getDocs(collection(db, 'properties')),
        authFetch(`/api/admin/users`),
      ]);
      if (!usersRes.ok) {
        const errText = await usersRes.text().catch(() => '');
        throw new Error(
          `Failed to load users (${usersRes.status}): ${errText || usersRes.statusText || 'no body'}`
        );
      }
      const usersData = await usersRes.json();

      const userMap = {};
      for (const u of usersData.users || []) {
        userMap[u.id] = u;
      }

      const props = propertiesSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => p.active !== false && p.archived !== true)
        .sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
          const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
          return bTime - aTime;
        });

      // Fetch opinion + registered interest counts from offers collection
      const propertyIds = props.map(p => p.id);
      const opinionCounts = {};
      const interestCounts = {};
      for (let i = 0; i < propertyIds.length; i += 30) {
        const batch = propertyIds.slice(i, i + 30);
        const offersSnap = await getDocs(
          query(collection(db, 'offers'), where('propertyId', 'in', batch))
        );
        offersSnap.docs.forEach(d => {
          const data = d.data();
          if (data.type === 'opinion') {
            opinionCounts[data.propertyId] = (opinionCounts[data.propertyId] || 0) + 1;
            if (data.serious === true) {
              interestCounts[data.propertyId] = (interestCounts[data.propertyId] || 0) + 1;
            }
          }
        });
      }

      // Attach counts to properties
      const propsWithCounts = props.map(p => ({
        ...p,
        _opinionCount: opinionCounts[p.id] || 0,
        _interestCount: interestCounts[p.id] || 0,
      }));

      setAllUsers(userMap);
      setProperties(propsWithCounts);

      // Fetch all agent docs referenced by properties
      const agentIds = [...new Set(props.map(p => p.agentId).filter(Boolean))];
      if (agentIds.length > 0) {
        const agentDocsMap = {};
        await Promise.all(
          agentIds.map(async (agentId) => {
            try {
              const agentDoc = await getDoc(doc(db, 'agents', agentId));
              if (agentDoc.exists()) {
                agentDocsMap[agentId] = { id: agentId, ...agentDoc.data() };
              }
            } catch (err) {
              console.error('Error fetching agent doc:', agentId, err);
            }
          })
        );
        setAllAgentDocs(agentDocsMap);
      }
    } catch (err) {
      console.error('Properties fetch error:', err);
    } finally {
      setPropertiesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredProperties = useMemo(() => {
    let result = properties;

    if (filter === 'public') result = result.filter((p) => p.visibility === true);
    else if (filter === 'private') result = result.filter((p) => !p.visibility);
    else if (filter === 'archived') result = result.filter((p) => p.archived === true);

    if (agentFilter) {
      result = result.filter((p) => p.agentId === agentFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((p) => {
        const address = (p.address || p.formattedAddress || '').toLowerCase();
        const agentUid = p.userId || p.uid;
        const agent = allUsers[agentUid];
        const agentName = agent
          ? [agent.firstName, agent.lastName].filter(Boolean).join(' ').toLowerCase()
          : '';
        return address.includes(q) || agentName.includes(q);
      });
    }

    return result;
  }, [properties, search, filter, agentFilter, allUsers]);

  // Selection helpers
  const allFilteredSelected = filteredProperties.length > 0 && filteredProperties.every(p => selectedIds.has(p.id));

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredProperties.forEach(p => next.delete(p.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredProperties.forEach(p => next.add(p.id));
        return next;
      });
    }
  };

  // Count properties per user
  const propertiesPerUser = useMemo(() => {
    const counts = {};
    properties.forEach(p => {
      const uid = p.userId || p.uid;
      if (uid) counts[uid] = (counts[uid] || 0) + 1;
    });
    return counts;
  }, [properties]);

  // Users list for reassignment modal
  const filteredUsers = useMemo(() => {
    const users = Object.values(allUsers);
    if (!reassignSearch.trim()) return users;
    const q = reassignSearch.toLowerCase();
    return users.filter(u => {
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ').toLowerCase();
      const email = (u.email || '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [allUsers, reassignSearch]);

  const handleReassign = async () => {
    if (!reassignTargetId || selectedIds.size === 0) return;
    setReassigning(true);
    try {
      const res = await authFetch('/api/admin/reassign-properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyIds: [...selectedIds],
          targetUserId: reassignTargetId,
          notify: reassignNotify,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reassign');
      setReassignSuccess(
        `${data.count} ${data.count === 1 ? 'property' : 'properties'} reassigned successfully` +
          (reassignNotify ? ` · ${data.notified || 0} agent email${data.notified === 1 ? '' : 's'} sent` : ''),
      );
      setSelectedIds(new Set());
      setTimeout(() => {
        setShowReassignModal(false);
        setReassignSuccess(null);
        setReassignTargetId(null);
        setReassignSearch('');
        fetchData();
      }, 1500);
    } catch (err) {
      console.error('Reassign error:', err);
      alert(err.message);
    } finally {
      setReassigning(false);
    }
  };

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'public', label: 'Public' },
    { key: 'private', label: 'Private' },
    { key: 'archived', label: 'Archived' },
  ];

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by address or agent name..."
          className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent shadow-sm text-sm"
        />
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              filter === f.key
                ? 'bg-orange-500 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            {f.label}
          </button>
        ))}
        {Object.keys(allAgentDocs).length > 0 && (
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="px-3 py-1.5 text-xs font-medium rounded-full border border-slate-200 text-slate-600 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20"
          >
            <option value="">All agents</option>
            {Object.values(allAgentDocs).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}

        {selectedIds.size > 0 && (
          <button
            onClick={() => { setShowReassignModal(true); setReassignSearch(''); setReassignTargetId(null); setReassignNotify(false); }}
            className="ml-auto px-4 py-1.5 text-xs font-semibold rounded-full bg-orange-500 text-white hover:bg-orange-600 transition-colors flex items-center gap-1.5"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            Re-assign ({selectedIds.size})
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
          {!propertiesLoading && filteredProperties.length > 0 && (
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500/20 accent-orange-500 cursor-pointer"
            />
          )}
          <h2 className="text-sm font-semibold text-slate-600">
            Properties ({filteredProperties.length})
          </h2>
        </div>

        {propertiesLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
          </div>
        ) : filteredProperties.length === 0 ? (
          <div className="text-center py-16">
            <Home className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">No properties found</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredProperties.map((p) => {
              const agentUid = p.userId || p.uid;
              const agent = allUsers[agentUid];
              const agentName = agent
                ? [agent.firstName, agent.lastName].filter(Boolean).join(' ')
                : 'Unknown';
              const isSelected = selectedIds.has(p.id);

              return (
                <div
                  key={p.id}
                  className={`px-6 py-4 flex items-center gap-4 hover:bg-slate-50 transition-colors group ${isSelected ? 'bg-orange-50/50' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(p.id)}
                    className="w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500/20 accent-orange-500 cursor-pointer flex-shrink-0"
                  />
                  <div
                    className="flex items-center gap-4 flex-1 min-w-0 cursor-pointer"
                    onClick={() => router.push(`/dashboard/property/${p.id}`)}
                  >
                    <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {getPropertyImage(p) ? (
                        <img src={getPropertyImage(p)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Building2 className="w-5 h-5 text-slate-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 text-sm truncate">
                        {p.formattedAddress || p.address || 'No address'}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {agentName}
                        {p.agentId && allAgentDocs[p.agentId] && (
                          <span className="text-orange-500"> ({allAgentDocs[p.agentId].name})</span>
                        )}
                        {' '}&middot; {p.price || '--'}
                      </p>
                    </div>
                    <div className="hidden sm:flex items-center gap-3 flex-shrink-0 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Eye className="w-3 h-3" /> {p.stats?.views || 0}
                      </span>
                      <span>{p._opinionCount || 0} opinions</span>
                      <span>{p._interestCount || 0} interested</span>
                    </div>
                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full flex-shrink-0 ${
                      p.visibility ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {p.visibility ? 'Public' : 'Private'}
                    </span>
                    <div className="hidden sm:block text-xs text-slate-500 w-28 text-right">
                      {formatDate(p.createdAt)}
                    </div>
                  </div>
                  <button
                    title="Open public listing"
                    onClick={() => window.open(`/find-property?propertyId=${p.id}`, '_blank')}
                    className="p-1.5 hover:bg-orange-50 rounded-lg text-slate-400 hover:text-orange-500 transition-colors flex-shrink-0"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                  <ChevronRight
                    className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0 cursor-pointer"
                    onClick={() => router.push(`/dashboard/property/${p.id}`)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reassignment Modal */}
      {showReassignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Re-assign Properties</h3>
                <p className="text-sm text-slate-500">{selectedIds.size} {selectedIds.size === 1 ? 'property' : 'properties'} selected</p>
              </div>
              <button onClick={() => setShowReassignModal(false)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {reassignSuccess ? (
              <div className="px-6 py-12 flex flex-col items-center gap-3">
                <CheckCircle2 className="w-12 h-12 text-emerald-500" />
                <p className="text-sm font-semibold text-slate-900">{reassignSuccess}</p>
              </div>
            ) : (
              <>
                <div className="px-6 pt-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={reassignSearch}
                      onChange={(e) => setReassignSearch(e.target.value)}
                      placeholder="Search users by name or email..."
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                      autoFocus
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-3 min-h-0">
                  {filteredUsers.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-8">No users found</p>
                  ) : (
                    <div className="space-y-1">
                      {filteredUsers.map((u) => {
                        const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Unnamed';
                        const isTarget = reassignTargetId === u.id;
                        return (
                          <button
                            key={u.id}
                            onClick={() => setReassignTargetId(u.id)}
                            className={`w-full text-left px-4 py-3 rounded-xl transition-colors flex items-center justify-between ${
                              isTarget
                                ? 'bg-orange-50 border border-orange-300'
                                : 'hover:bg-slate-50 border border-transparent'
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-900 truncate">{name}</p>
                              <p className="text-xs text-slate-500 truncate">{u.email || 'No email'}</p>
                            </div>
                            <span className="text-xs text-slate-400 flex-shrink-0 ml-3">
                              {propertiesPerUser[u.id] || 0} properties
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="px-6 pt-4 border-t border-slate-200">
                  <label className="flex items-start gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={reassignNotify}
                      onChange={(e) => setReassignNotify(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      Email the agent that these properties were assigned to them
                      <span className="block text-xs text-slate-400">Off by default. Tick only for a genuine individual assignment (up to 25 properties). Skipped automatically for inactive or disabled agents.</span>
                    </span>
                  </label>
                </div>
                <div className="px-6 py-4 flex items-center justify-end gap-3">
                  <button
                    onClick={() => setShowReassignModal(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleReassign}
                    disabled={!reassignTargetId || reassigning}
                    className="px-5 py-2 text-sm font-semibold bg-orange-500 text-white rounded-xl hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {reassigning && <Loader2 className="w-4 h-4 animate-spin" />}
                    {reassigning ? 'Reassigning...' : 'Confirm'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
