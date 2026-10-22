'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Search, ChevronRight, Trash2, Loader2 } from 'lucide-react';
import { formatDate } from '../../utils/formatters';
import { useToast } from '../ToastProvider';
import useConfirm from '../../hooks/useConfirm';
import { authFetch } from '../../../../utils/authFetch';

export default function UsersTab({ user }) {
  const router = useRouter();
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    async function fetchUsers() {
      try {
        const res = await authFetch(`/api/admin/users`);
        const data = await res.json();
        setUsers(data.users || []);
      } catch (err) {
        console.error('Users fetch error:', err);
      } finally {
        setUsersLoading(false);
      }
    }
    fetchUsers();
  }, [user.uid]);

  const filteredUsers = useMemo(() => {
    let result = [...users];

    // Apply filter
    if (filter === 'agents') result = result.filter((u) => u.isAgent);
    else if (filter === 'buyers') result = result.filter((u) => u.isBuyer);
    else if (filter === 'pro') result = result.filter((u) => u.pro);
    else if (filter === 'superadmin') result = result.filter((u) => u.superAdmin);

    // Apply search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (u) =>
          u.firstName?.toLowerCase().includes(q) ||
          u.lastName?.toLowerCase().includes(q) ||
          u.email?.toLowerCase().includes(q)
      );
    }

    // Sort newest first
    result.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

    return result;
  }, [users, search, filter]);

  const handleDelete = async (e, u) => {
    e.stopPropagation();
    if (u.superAdmin) {
      toast.error('Cannot delete superAdmin users');
      return;
    }
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
    const ok = await confirm({
      title: 'Delete User',
      message: `Are you sure you want to delete ${name}? This will permanently remove all their data including properties, offers, and likes.`,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!ok) return;

    setDeletingId(u.id);
    try {
      const res = await authFetch(`/api/admin/users/${u.id}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok) {
        setUsers((prev) => prev.filter((x) => x.id !== u.id));
        toast.success(`Deleted ${name} (${data.deleted.properties} properties, ${data.deleted.offers} offers)`);
      } else {
        toast.error(data.error || 'Failed to delete user');
      }
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Failed to delete user');
    } finally {
      setDeletingId(null);
    }
  };

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'agents', label: 'Agents' },
    { key: 'buyers', label: 'Buyers' },
    { key: 'pro', label: 'Pro' },
    { key: 'superadmin', label: 'Super Admin' },
  ];

  return (
    <div className="space-y-4">
      {ConfirmDialog}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email..."
          className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent shadow-sm text-sm"
        />
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
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
      </div>

      {/* Users list */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-600">
            Users ({filteredUsers.length})
          </h2>
        </div>

        {usersLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="text-center py-16">
            <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">No users found</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredUsers.map((u) => (
              <div
                key={u.id}
                onClick={() => router.push(`/dashboard/admin/users/${u.id}`)}
                className="w-full text-left px-6 py-4 flex items-center gap-4 hover:bg-slate-50 transition-colors group cursor-pointer"
              >
                <div className="w-10 h-10 bg-gradient-to-br from-orange-400 to-amber-500 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                  {(u.firstName?.[0] || u.email?.[0] || '?').toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900 text-sm truncate">
                    {[u.firstName, u.lastName].filter(Boolean).join(' ') || 'No name'}
                  </p>
                  <p className="text-xs text-slate-500 truncate">{u.email}</p>
                </div>
                <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
                  {u.superAdmin && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-100 text-red-700">ADMIN</span>
                  )}
                  {u.pro && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-orange-100 text-orange-700">PRO</span>
                  )}
                  {u.isAgent && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-blue-100 text-blue-700">AGENT</span>
                  )}
                </div>
                <div className="hidden sm:block text-xs text-slate-400 w-20 text-right">
                  {u.propertyCount} props
                </div>
                <div className="hidden sm:block text-xs text-slate-500 w-28 text-right">
                  {formatDate(u.createdAt)}
                </div>
                {!u.superAdmin && (
                  <button
                    onClick={(e) => handleDelete(e, u)}
                    disabled={deletingId === u.id}
                    className="p-2 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0 disabled:opacity-50"
                    title="Delete user"
                  >
                    {deletingId === u.id ? (
                      <Loader2 className="w-4 h-4 animate-spin text-red-400" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                )}
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
