'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '../../../../context/AuthContext';
import { db } from '../../../../firebase/clientApp';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  ShieldX,
  Check,
  Trash2,
  Key,
  Lock,
  Star,
  Crown,
  BarChart3,
  Home,
  Eye,
  MessageSquare,
  Building2,
  ChevronRight,
  Send,
  Loader2,
  Mail,
  BellOff,
  Bell,
} from 'lucide-react';
import { useToast } from '../../components/ToastProvider';
import useConfirm from '../../hooks/useConfirm';
import Toggle from '../../components/Toggle';
import AdminModal from '../../components/AdminModal';
import { formatDate, formatDateWithTime, getPropertyImage } from '../../utils/formatters';
import { authFetch } from '../../../../utils/authFetch';
import PropertyThumb from '../../../../components/PropertyThumb';

export default function AdminUserPage() {
  const { user, userData, loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const userId = params.id;
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [targetUser, setTargetUser] = useState(null);
  const [properties, setProperties] = useState([]);
  const [notes, setNotes] = useState([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailType, setEmailType] = useState('password_reset');
  const [emailPropertyId, setEmailPropertyId] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Fetch user data, properties, and notes
  const fetchData = useCallback(async () => {
    if (!user || !userId) return;
    setPageLoading(true);
    try {
      const { doc: docRef, getDoc } = await import('firebase/firestore');
      const userDoc = await getDoc(docRef(db, 'users', userId));

      if (!userDoc.exists()) {
        router.push('/dashboard/admin');
        return;
      }

      setTargetUser({ id: userDoc.id, ...userDoc.data() });

      const propsSnap = await getDocs(
        query(collection(db, 'properties'), where('userId', '==', userId))
      );
      let userProperties = propsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      if (userProperties.length === 0) {
        const propsSnap2 = await getDocs(
          query(collection(db, 'properties'), where('uid', '==', userId))
        );
        userProperties = propsSnap2.docs.map((d) => ({ id: d.id, ...d.data() }));
      }

      userProperties.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
        const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
        return bTime - aTime;
      });
      setProperties(userProperties);

      await fetchNotes();
    } catch (err) {
      console.error('Error fetching user data:', err);
    } finally {
      setPageLoading(false);
    }
  }, [user, userId]);

  const fetchNotes = useCallback(async () => {
    if (!user || !userId) return;
    try {
      const res = await authFetch(`/api/admin/users/${userId}/notes`);
      const data = await res.json();
      setNotes(data.notes || []);
    } catch (err) {
      console.error('Error fetching notes:', err);
    }
  }, [user, userId]);

  useEffect(() => {
    if (user && userData?.superAdmin === true) {
      fetchData();
    }
  }, [user, userData, fetchData]);

  // Toggle user fields
  const handleToggle = async (field) => {
    if (!targetUser) return;
    setActionLoading(field);
    try {
      const res = await authFetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUid: userId,
          updates: { [field]: !targetUser[field] },
        }),
      });

      if (res.ok) {
        setTargetUser((prev) => ({ ...prev, [field]: !prev[field] }));
        const label = field === 'pro' ? 'Pro' : field === 'superAdmin' ? 'Admin' : field === 'marketReportOptIn' ? 'Market Report' : field === 'unsubscribed' ? 'Subscription' : field;
        toast.success(`${label} updated`);
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to update');
      }
    } catch (err) {
      console.error('Toggle error:', err);
      toast.error('Failed to update');
    } finally {
      setActionLoading(null);
    }
  };

  // Reset password
  const handleResetPassword = async () => {
    const ok = await confirm({
      title: 'Send Password Reset',
      message: `Send a password reset email to ${targetUser.email}?`,
      confirmLabel: 'Send Reset Email',
    });
    if (!ok) return;
    setActionLoading('resetPassword');
    try {
      const res = await authFetch(`/api/admin/users/${userId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('Password reset email sent');
      } else {
        toast.error(data.error || 'Failed to send reset email');
      }
    } catch (err) {
      console.error('Reset password error:', err);
      toast.error('Failed to send reset email');
    } finally {
      setActionLoading(null);
    }
  };

  // API access actions
  const handleApiAction = async (action) => {
    setActionLoading(`api-${action}`);
    try {
      const res = await authFetch('/api/admin/api-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUid: userId, action }),
      });

      if (res.ok) {
        const { doc: docRef, getDoc } = await import('firebase/firestore');
        const userDoc = await getDoc(docRef(db, 'users', userId));
        if (userDoc.exists()) {
          setTargetUser({ id: userDoc.id, ...userDoc.data() });
        }
        toast.success(`API access ${action}d`);
      } else {
        const data = await res.json();
        toast.error(data.error || 'Action failed');
      }
    } catch (err) {
      console.error('API action error:', err);
      toast.error('Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  // Add note
  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!noteText.trim()) return;
    setNoteSubmitting(true);
    try {
      const res = await authFetch(`/api/admin/users/${userId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: noteText }),
      });

      if (res.ok) {
        setNoteText('');
        await fetchNotes();
        toast.success('Note added');
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to add note');
      }
    } catch (err) {
      console.error('Add note error:', err);
      toast.error('Failed to add note');
    } finally {
      setNoteSubmitting(false);
    }
  };

  // Delete note
  const handleDeleteNote = async (noteId) => {
    const ok = await confirm({
      title: 'Delete Note',
      message: 'Are you sure you want to delete this note?',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await authFetch(`/api/admin/users/${userId}/notes`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId }),
      });

      if (res.ok) {
        await fetchNotes();
        toast.success('Note deleted');
      } else {
        toast.error('Failed to delete note');
      }
    } catch (err) {
      console.error('Delete note error:', err);
    }
  };

  // Send email
  const handleSendEmail = async () => {
    setEmailSending(true);
    try {
      const body = { emailType };
      if (emailType === 'property_live' || emailType === 'follow_up') {
        if (!emailPropertyId) {
          toast.error('Please select a property');
          setEmailSending(false);
          return;
        }
        body.propertyId = emailPropertyId;
      }

      const res = await authFetch(`/api/admin/users/${userId}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || 'Email sent');
        setShowEmailModal(false);
      } else {
        toast.error(data.error || 'Failed to send email');
      }
    } catch (err) {
      console.error('Send email error:', err);
      toast.error('Failed to send email');
    } finally {
      setEmailSending(false);
    }
  };

  // Delete user
  const handleDeleteUser = async () => {
    const name = [targetUser.firstName, targetUser.lastName].filter(Boolean).join(' ') || targetUser.email;
    const ok = await confirm({
      title: 'Delete User',
      message: `Are you sure you want to delete ${name}? This will permanently remove all their data including properties, offers, and likes.`,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!ok) return;

    setDeleteLoading(true);
    try {
      const res = await authFetch(`/api/admin/users/${userId}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(`Deleted: ${data.deleted.properties} properties, ${data.deleted.offers} offers, ${data.deleted.likes} likes`);
        setTimeout(() => router.push('/dashboard/admin'), 1500);
      } else {
        toast.error(data.error || 'Failed to delete user');
      }
    } catch (err) {
      console.error('Delete user error:', err);
      toast.error('Failed to delete user');
    } finally {
      setDeleteLoading(false);
    }
  };

  if (loading || !user || pageLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    );
  }

  if (!targetUser) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-slate-500">User not found</p>
      </div>
    );
  }

  const name = [targetUser.firstName, targetUser.lastName].filter(Boolean).join(' ') || 'No name';
  const totalViews = properties.reduce((sum, p) => sum + (p.stats?.views || 0), 0);
  const totalOpinions = properties.reduce((sum, p) => sum + (p.stats?.opinions || 0), 0);
  const activeCampaigns = properties.filter((p) => p.visibility === true).length;
  const apiStatus = targetUser.apiAccess?.status;
  const maskedKey = targetUser.apiAccess?.apiKey
    ? targetUser.apiAccess.apiKey.slice(0, 6) + '...' + targetUser.apiAccess.apiKey.slice(-4)
    : null;
  const needsProperty = emailType === 'property_live' || emailType === 'follow_up';

  return (
    <div>
      {ConfirmDialog}

      {/* Breadcrumb + User Info */}
      <div className="flex items-center gap-2 text-sm mb-6">
        <Link href="/dashboard/admin?tab=users" className="text-slate-400 hover:text-slate-600 transition-colors">
          Users
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
        <span className="font-semibold text-slate-900 truncate">{name}</span>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-amber-500 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
          {(targetUser.firstName?.[0] || targetUser.email?.[0] || '?').toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-slate-900 truncate">{name}</h1>
          <p className="text-sm text-slate-500 truncate">{targetUser.email}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {targetUser.superAdmin && (
            <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-red-100 text-red-700">ADMIN</span>
          )}
          {targetUser.pro && (
            <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-orange-100 text-orange-700">PRO</span>
          )}
          {targetUser.isAgent && (
            <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-100 text-blue-700">AGENT</span>
          )}
          {targetUser.isBuyer && (
            <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-100 text-emerald-700">BUYER</span>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {/* Toggles */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">User Settings</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Toggle
              checked={targetUser.pro || false}
              onChange={() => handleToggle('pro')}
              label="Pro Status"
              description="Access to premium features"
              loading={actionLoading === 'pro'}
            />
            <Toggle
              checked={targetUser.superAdmin || false}
              onChange={() => handleToggle('superAdmin')}
              label="Admin Status"
              description="Full admin dashboard access"
              loading={actionLoading === 'superAdmin'}
            />
            <Toggle
              checked={targetUser.marketReportOptIn || false}
              onChange={() => handleToggle('marketReportOptIn')}
              label="Market Report"
              description="Daily AI market report emails"
              loading={actionLoading === 'marketReportOptIn'}
            />
            <Toggle
              checked={!targetUser.unsubscribed}
              onChange={() => handleToggle('unsubscribed')}
              label="Email Subscribed"
              description={targetUser.unsubscribed ? 'User is unsubscribed' : 'Receiving all emails'}
              loading={actionLoading === 'unsubscribed'}
            />
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Actions</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleResetPassword}
              disabled={actionLoading === 'resetPassword'}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors disabled:opacity-50"
            >
              {actionLoading === 'resetPassword' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              Reset Password
            </button>
            <button
              onClick={() => { setShowEmailModal(true); setEmailType('password_reset'); setEmailPropertyId(''); }}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
            >
              <Mail className="w-4 h-4" />
              Send Email
            </button>
            {!targetUser.superAdmin && (
              <button
                onClick={handleDeleteUser}
                disabled={deleteLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
              >
                {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete User & Data
              </button>
            )}
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-1">
              <Home className="w-4 h-4 text-slate-400" />
              <p className="text-xs text-slate-500">Properties</p>
            </div>
            <p className="text-2xl font-bold text-slate-900">{properties.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-1">
              <Eye className="w-4 h-4 text-slate-400" />
              <p className="text-xs text-slate-500">Total Views</p>
            </div>
            <p className="text-2xl font-bold text-slate-900">{totalViews.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="w-4 h-4 text-slate-400" />
              <p className="text-xs text-slate-500">Total Opinions</p>
            </div>
            <p className="text-2xl font-bold text-slate-900">{totalOpinions}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-4 h-4 text-slate-400" />
              <p className="text-xs text-slate-500">Active Campaigns</p>
            </div>
            <p className="text-2xl font-bold text-slate-900">{activeCampaigns}</p>
          </div>
        </div>

        {/* Properties */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-3 bg-slate-50 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-600">Properties ({properties.length})</h2>
          </div>
          {properties.length === 0 ? (
            <div className="text-center py-12">
              <Home className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No properties</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {properties.map((p) => (
                <Link
                  key={p.id}
                  href={`/dashboard/property/${p.id}`}
                  className="px-6 py-4 flex items-center gap-4 hover:bg-slate-50 transition-colors group block"
                >
                  <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {getPropertyImage(p) ? (
                      <PropertyThumb src={getPropertyImage(p)} width={40} height={40} className="w-full h-full object-cover" />
                    ) : (
                      <Building2 className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 text-sm truncate">
                      {p.address || p.formattedAddress || 'No address'}
                    </p>
                    <p className="text-xs text-slate-500">{p.price || '--'}</p>
                  </div>
                  <div className="hidden sm:flex items-center gap-3 text-xs text-slate-400 flex-shrink-0">
                    <span className="flex items-center gap-1">
                      <Eye className="w-3 h-3" /> {p.stats?.views || 0}
                    </span>
                  </div>
                  <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full flex-shrink-0 ${
                    p.visibility ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {p.visibility ? 'Public' : 'Private'}
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Notes Section */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-3 bg-slate-50 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-600">Admin Notes ({notes.length})</h2>
          </div>

          <form onSubmit={handleAddNote} className="px-6 py-4 border-b border-slate-100">
            <div className="flex gap-2">
              <input
                type="text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note..."
                className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
              <button
                type="submit"
                disabled={noteSubmitting || !noteText.trim()}
                className="px-4 py-2.5 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {noteSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </form>

          {notes.length === 0 ? (
            <div className="text-center py-8">
              <MessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-400 text-sm">No notes yet</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {notes.map((note) => (
                <div key={note.id} className="px-6 py-3 flex items-start gap-3 group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700">{note.text}</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {note.createdByName || 'Admin'} &middot; {formatDateWithTime(note.createdAt)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteNote(note.id)}
                    className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                    title="Delete note"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* API Access Section */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-3 bg-slate-50 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-600">API Access</h2>
          </div>
          <div className="px-6 py-5">
            {!apiStatus || apiStatus === 'none' ? (
              <p className="text-sm text-slate-400">No API access requested</p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-600">Status:</span>
                  <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
                    apiStatus === 'approved'
                      ? 'bg-emerald-100 text-emerald-700'
                      : apiStatus === 'pending'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-red-100 text-red-700'
                  }`}>
                    {apiStatus.charAt(0).toUpperCase() + apiStatus.slice(1)}
                  </span>
                </div>

                {maskedKey && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-600">API Key:</span>
                    <span className="font-mono text-sm text-slate-800 bg-slate-100 px-2 py-1 rounded">{maskedKey}</span>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-2">
                  {(apiStatus === 'pending' || apiStatus === 'revoked') && (
                    <button
                      onClick={() => handleApiAction('approve')}
                      disabled={actionLoading === 'api-approve'}
                      className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                    >
                      {actionLoading === 'api-approve' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Approve
                    </button>
                  )}
                  {apiStatus === 'approved' && (
                    <>
                      <button
                        onClick={() => handleApiAction('revoke')}
                        disabled={actionLoading === 'api-revoke'}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
                      >
                        {actionLoading === 'api-revoke' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldX className="w-4 h-4" />}
                        Revoke
                      </button>
                      <button
                        onClick={() => handleApiAction('regenerate')}
                        disabled={actionLoading === 'api-regenerate'}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors disabled:opacity-50"
                      >
                        {actionLoading === 'api-regenerate' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                        Regenerate Key
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Joined date */}
        <div className="text-center text-xs text-slate-400 py-4">
          Joined {formatDate(targetUser.createdAt)}
        </div>
      </div>

      {/* Send Email Modal */}
      <AdminModal
        isOpen={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        title="Send Email"
        size="md"
        footer={
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowEmailModal(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSendEmail}
              disabled={emailSending || (needsProperty && !emailPropertyId)}
              className="px-4 py-2 text-sm font-medium bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {emailSending && <Loader2 className="w-4 h-4 animate-spin" />}
              Send Email
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Send an email to <strong>{targetUser.email}</strong></p>

          <div className="space-y-2">
            {[
              { value: 'password_reset', label: 'Password Reset', desc: 'Send a password reset link' },
              { value: 'welcome', label: 'Welcome Email', desc: 'Resend the welcome message' },
              { value: 'property_live', label: 'Property Live', desc: 'Notify that a property is live' },
              { value: 'follow_up', label: 'Follow Up', desc: 'Check in on a listing' },
            ].map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  emailType === opt.value ? 'border-orange-300 bg-orange-50' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="emailType"
                  value={opt.value}
                  checked={emailType === opt.value}
                  onChange={(e) => setEmailType(e.target.value)}
                  className="mt-0.5 accent-orange-500"
                />
                <div>
                  <p className="text-sm font-medium text-slate-900">{opt.label}</p>
                  <p className="text-xs text-slate-500">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>

          {needsProperty && (
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">Select Property</label>
              {properties.length === 0 ? (
                <p className="text-sm text-slate-400">No properties available</p>
              ) : (
                <select
                  value={emailPropertyId}
                  onChange={(e) => setEmailPropertyId(e.target.value)}
                  className="w-full px-3 py-2 text-sm text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="">Choose a property...</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.address || p.formattedAddress || p.id}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      </AdminModal>

    </div>
  );
}
