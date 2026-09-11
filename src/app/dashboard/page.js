'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../context/AuthContext';
import { authFetch } from '../utils/authFetch';
import { isBuyerOnly } from '../utils/roles';
import { db } from '../firebase/clientApp';
import { collection, query, where, getDocs, doc, updateDoc, onSnapshot, orderBy } from 'firebase/firestore';
import { formatPrice, formatDate } from '../utils/formatters';
import {
  LayoutDashboard,
  Home,
  Plus,
  Download,
  LogOut,
  Menu,
  X,
  Eye,
  MessageSquare,
  Heart,
  TrendingUp,
  ChevronRight,
  Bed,
  Bath,
  Car,
  Shield,
  BookOpen,
  Video,
  Pencil,
  Archive,
  CheckCircle,
  Upload,
  Settings,
  User,
  Users,
  Trash2,
  ExternalLink,
  Camera,
  Building2,
  Loader2,
} from 'lucide-react';

// --- Shimmer Image Wrapper ---
function ShimmerImage({ src, alt, ...props }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && (
        <div className="absolute inset-0 bg-slate-200 animate-pulse" />
      )}
      <Image
        src={src}
        alt={alt}
        {...props}
        onLoad={() => setLoaded(true)}
        style={{ opacity: loaded ? 1 : 0, transition: 'opacity 0.3s ease' }}
      />
    </>
  );
}

// --- Sidebar ---
function Sidebar({ active, onNavigate, onSignOut, sidebarOpen, setSidebarOpen, userName, userData }) {
  const navItems = [
    { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'sold', label: 'Sold', icon: CheckCircle },
    { id: 'archived', label: 'Archive', icon: Archive },
    { id: 'add', label: 'Add Property', icon: Plus, href: '/dashboard/add' },
    { id: 'user-manual', label: 'User Manual', icon: BookOpen, href: '/dashboard/user-manual' },
    { id: 'agents', label: 'Team', icon: Users, href: '/dashboard/agents' },
    { id: 'settings', label: 'Settings', icon: Settings, href: '/dashboard/settings' },
    ...(userData?.superAdmin === true
      ? [{ id: 'admin', label: 'Admin', icon: Shield, href: '/dashboard/admin' }]
      : []),
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-6 border-b border-slate-200">
        <Link href="/">
          <Image
            src="https://premarketvideos.b-cdn.net/assets/logo.png"
            alt="Premarket"
            width={140}
            height={35}
            className="h-7 w-auto"
            unoptimized
          />
        </Link>
      </div>

      {/* User Info */}
      <div className="px-6 py-4 border-b border-slate-200">
        <div className="flex items-center gap-3">
          {userData?.avatar ? (
            <img
              src={userData.avatar}
              alt=""
              className="w-10 h-10 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
              <User className="w-5 h-5 text-orange-600" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xs text-slate-500">Welcome back,</p>
            {userData?.companyName ? (
              <p className="text-slate-900 font-semibold truncate">{userData.companyName}</p>
            ) : (
              <Link href="/dashboard/settings" className="text-orange-500 hover:text-orange-600 text-sm font-semibold">
                Add Agency Details
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Nav Items */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          if (item.href) {
            return (
              <Link
                key={item.id}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          }
          return (
            <button
              key={item.id}
              onClick={() => {
                onNavigate(item.id);
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className="w-5 h-5" />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Bottom Actions */}
      <div className="px-3 py-4 border-t border-slate-200 space-y-1">
        <a
          href="https://apps.apple.com/au/app/premarket-homes/id6742205449"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all"
        >
          <Download className="w-5 h-5" />
          Download App
        </a>
        <button
          onClick={onSignOut}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-all"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-30">
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-64 bg-white border-r border-slate-200 z-50 lg:hidden"
            >
              <button
                onClick={() => setSidebarOpen(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900"
              >
                <X className="w-5 h-5" />
              </button>
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// --- Stat Card ---
function StatCard({ label, value, icon: Icon }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl p-5 border border-slate-200"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
          <Icon className="w-5 h-5 text-slate-500" />
        </div>
      </div>
      <div className="text-3xl font-bold text-slate-900">{value}</div>
      <div className="text-sm text-slate-500 mt-1">{label}</div>
    </motion.div>
  );
}

// --- Property Card ---
function PropertyCard({ property, onToggleVisibility, toggling, onArchive, archiving, isArchived, isSold, onHide, teamAgents }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-lg transition-shadow"
    >
      {/* Image — clickable to preview listing */}
      <a
        href={`/find-property?propertyId=${property.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block relative h-48 bg-slate-100 cursor-pointer group"
      >
        {property.imageUrls?.[0] ? (
          <ShimmerImage
            src={property.imageUrls[0]}
            alt={property.address || 'Property'}
            fill
            className="object-cover group-hover:scale-[1.02] transition-transform duration-300"
            unoptimized
          />
        ) : property.imageUploadProgress?.inProgress ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-slate-50">
            <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-medium text-slate-500">Uploading media...</p>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Home className="w-12 h-12 text-slate-300" />
          </div>
        )}
        {/* Status Badge */}
        <div className="absolute top-3 left-3">
          <span className={`inline-flex px-2.5 py-1 text-xs font-semibold rounded-full ${
            isSold
              ? 'bg-emerald-100 text-emerald-700'
              : property.archived === true
                ? 'bg-amber-100 text-amber-700'
                : property.visibility === true
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-500'
          }`}>
            {isSold ? 'Sold' : property.archived === true ? 'Archived' : property.visibility === true ? 'Public' : 'Private'}
          </span>
        </div>
        {/* Top-right badges */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          <span className={`px-2 py-1 text-[10px] font-bold rounded-full ${
            property.listingStatus === 'on-market'
              ? 'bg-emerald-600 text-white'
              : 'bg-gradient-to-r from-[#e48900] to-[#c64500] text-white'
          }`}>
            {property.listingStatus === 'on-market' ? 'On Market' : 'Pre-Market'}
          </span>
          {(property.videoUrl || property.aiVideo?.url) && (
            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full bg-black/60 text-white">
              <Video className="w-3 h-3" />
            </span>
          )}
        </div>
        {/* Upload Progress Bar */}
        {property.imageUploadProgress?.inProgress && (
          <div className="absolute bottom-0 left-0 right-0">
            <div className="h-1 bg-slate-200">
              <div
                className="h-full bg-orange-500 transition-all duration-500"
                style={{ width: `${property.imageUploadProgress.total > 0 ? (property.imageUploadProgress.uploaded / property.imageUploadProgress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </a>

      {/* Details — address clickable to preview listing */}
      <div className="p-4">
        <a
          href={`/find-property?propertyId=${property.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-slate-900 text-sm truncate mb-1 block hover:text-orange-600 transition-colors"
        >
          {property.formattedAddress || property.address || 'No address'}
        </a>
        {property.agentId && teamAgents?.length > 0 && (() => {
          const agent = teamAgents.find(a => a.id === property.agentId);
          return agent ? <p className="text-xs text-slate-500 mb-0.5">{agent.name}</p> : null;
        })()}
        <p className="text-lg font-bold text-slate-900 mb-2">{formatPrice(property.price)}</p>
        {isSold && (
          <p className="text-xs font-semibold text-emerald-700 mb-2 flex items-center gap-1">
            <CheckCircle className="w-3.5 h-3.5" />
            {property.soldPrice ? `Sold ${formatPrice(property.soldPrice)}` : 'Sold'}
            {property.soldAt ? ` · ${formatDate(property.soldAt)}` : ''}
          </p>
        )}

        <div className="flex items-center gap-3 text-xs text-slate-500 mb-3">
          {property.bedrooms != null && (
            <span className="flex items-center gap-1"><Bed className="w-3.5 h-3.5" />{property.bedrooms}</span>
          )}
          {property.bathrooms != null && (
            <span className="flex items-center gap-1"><Bath className="w-3.5 h-3.5" />{property.bathrooms}</span>
          )}
          {property.carSpaces != null && (
            <span className="flex items-center gap-1"><Car className="w-3.5 h-3.5" />{property.carSpaces}</span>
          )}
        </div>

        {/* Stats Row */}
        <div className="flex items-center gap-4 text-xs text-slate-500 mb-4">
          <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{property.stats?.views || 0} views</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/property/${property.id}`}
            className="flex-1 text-center px-3 py-2 text-xs font-semibold text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-lg transition-colors"
          >
            View Report
          </Link>
          <Link
            href={`/dashboard/edit/${property.id}`}
            className="px-3 py-2 text-xs font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1"
          >
            <Pencil className="w-3 h-3" />
            Edit
          </Link>
          {isArchived && !isSold && onHide && (
            <button
              onClick={() => onHide(property)}
              className="px-3 py-2 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors flex items-center gap-1"
              title="Hide from archive"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// --- Download Banner ---
function DownloadBanner() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('dashboard_banner_dismissed');
    if (!stored) setDismissed(false);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    localStorage.setItem('dashboard_banner_dismissed', 'true');
  };

  if (dismissed) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="bg-white rounded-xl border border-slate-200 p-4 mb-6"
    >
      <div className="flex items-center justify-between gap-4 flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <Download className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <p className="font-semibold text-slate-900 text-sm">Get the Premarket app</p>
            <p className="text-xs text-slate-500">Manage your properties on the go</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="https://apps.apple.com/au/app/premarket-homes/id6742205449"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-black text-white px-4 py-2.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
            </svg>
            <div className="text-left">
              <div className="text-[10px] opacity-80 leading-tight">Download on the</div>
              <div className="text-xs font-semibold leading-tight">App Store</div>
            </div>
          </a>
          <a
            href="https://play.google.com/store/apps/details?id=com.premarkethomes.app&hl=en"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-black text-white px-4 py-2.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3,20.5V3.5C3,2.91 3.34,2.39 3.84,2.15L13.69,12L3.84,21.85C3.34,21.6 3,21.09 3,20.5M16.81,15.12L6.05,21.34L14.54,12.85L16.81,15.12M20.16,10.81C20.5,11.08 20.75,11.5 20.75,12C20.75,12.5 20.53,12.9 20.18,13.18L17.89,14.5L15.39,12L17.89,9.5L20.16,10.81M6.05,2.66L16.81,8.88L14.54,11.15L6.05,2.66Z" />
            </svg>
            <div className="text-left">
              <div className="text-[10px] opacity-80 leading-tight">Get it on</div>
              <div className="text-xs font-semibold leading-tight">Google Play</div>
            </div>
          </a>
          <button onClick={dismiss} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-400 hover:text-slate-600 ml-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// --- Empty State ---
function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-slate-200 p-12 text-center"
    >
      <div className="w-20 h-20 bg-orange-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
        <Home className="w-10 h-10 text-orange-500" />
      </div>
      <h3 className="text-xl font-bold text-slate-900 mb-2">No properties yet</h3>
      <p className="text-slate-500 mb-6 max-w-md mx-auto">
        Add your first property to start collecting buyer opinions and market insights.
      </p>
      <Link
        href="/dashboard/add"
        className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-semibold rounded-xl shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 transition-all"
      >
        <Plus className="w-5 h-5" />
        Add Your First Property
      </Link>
    </motion.div>
  );
}

// --- Logo Upload Modal ---
function LogoUploadModal({ show, onClose, user, userData, setUserData }) {
  const fileInputRef = useRef(null);
  const [preview, setPreview] = useState(userData?.logoUrl || '');
  const [file, setFile] = useState(null);
  const [agencyTitle, setAgencyTitle] = useState(userData?.companyName || '');
  const [uploading, setUploading] = useState(false);

  if (!show) return null;

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPreview(URL.createObjectURL(f));
    setFile(f);
  };

  const handleUpload = async () => {
    if (!file && !agencyTitle.trim()) return;
    setUploading(true);
    try {
      const updates = {};
      if (agencyTitle.trim()) updates.companyName = agencyTitle.trim();
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await authFetch('/api/upload-image', { method: 'POST', body: formData });
        if (res.ok) {
          const { url } = await res.json();
          updates.logoUrl = url;
        }
      }
      if (Object.keys(updates).length > 0) {
        await updateDoc(doc(db, 'users', user.uid), updates);
        setUserData((prev) => ({ ...prev, ...updates }));
      }
      onClose();
    } catch (err) {
      console.error('Logo upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleSkip = () => {
    localStorage.setItem('logo_onboarding_dismissed', 'true');
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleSkip(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
      >
        <div className="px-6 pt-6 pb-4">
          <h2 className="text-lg font-bold text-slate-900 mb-1">Add your agency logo</h2>
          <p className="text-sm text-slate-500 mb-5">
            Your logo will appear across the platform:
          </p>
          <ul className="text-xs text-slate-500 space-y-1 mb-5">
            <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-orange-400" />Property listing cards</li>
            <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-orange-400" />TV display mode</li>
            <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-orange-400" />Property detail pages</li>
          </ul>

          <div className="flex flex-col items-center gap-4 mb-5">
            <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              {preview ? (
                <img src={preview} alt="Logo preview" className="w-24 h-24 rounded-xl object-cover" />
              ) : (
                <div className="w-24 h-24 rounded-xl bg-slate-100 flex items-center justify-center">
                  <Building2 className="w-10 h-10 text-slate-300" />
                </div>
              )}
              <div className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-all">
                <Camera className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-sm font-semibold text-orange-600 hover:text-orange-700"
            >
              {preview ? 'Choose different image' : 'Select logo image'}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
          </div>

          <div className="px-0">
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Agency Title</label>
            <input
              type="text"
              value={agencyTitle}
              onChange={(e) => setAgencyTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-all"
              placeholder="e.g. Ray White, LJ Hooker"
            />
          </div>
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={handleSkip}
            className="flex-1 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
          >
            Skip for now
          </button>
          <button
            onClick={handleUpload}
            disabled={(!file && !agencyTitle.trim()) || uploading}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-[#e48900] to-[#c64500] rounded-xl shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {uploading ? <><Loader2 className="w-4 h-4 animate-spin" />Saving...</> : 'Save'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- Logo Nudge Pill ---
function LogoNudge({ onClick }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes logo-nudge-glow {
          0%, 100% { box-shadow: 0 4px 14px rgba(234, 137, 0, 0.2); }
          50% { box-shadow: 0 4px 20px rgba(234, 137, 0, 0.45); }
        }
      `}} />
      <motion.button
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        onClick={onClick}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 bg-white border border-orange-200 rounded-full shadow-lg hover:shadow-orange-500/40 transition-all cursor-pointer"
        style={{ animation: 'logo-nudge-glow 2s ease-in-out infinite' }}
      >
        <Building2 className="w-4 h-4 text-orange-500" />
        <span className="text-sm font-semibold text-slate-700">Add logo</span>
      </motion.button>
    </>
  );
}

// --- Main Dashboard ---
export default function DashboardPageWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    }>
      <DashboardPage />
    </Suspense>
  );
}

function DashboardPage() {
  const { user, userData, setUserData, loading, signOut } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [properties, setProperties] = useState([]);
  const [propertiesLoading, setPropertiesLoading] = useState(true);
  const [opinionsCount, setOpinionsCount] = useState(0);
  const [activeTab, setActiveTab] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [successModal, setSuccessModal] = useState(null); // 'created' | 'updated' | null
  const [showLogoModal, setShowLogoModal] = useState(false);
  const [teamAgents, setTeamAgents] = useState([]);
  const [filterAgentId, setFilterAgentId] = useState('');

  // Logo onboarding for agents without a logo
  useEffect(() => {
    if (!userData) return;
    if ((userData.isAgent || userData.agent) && !userData.logoUrl && !localStorage.getItem('logo_onboarding_dismissed')) {
      setShowLogoModal(true);
    }
  }, [userData]);

  // Show success modal from URL params
  useEffect(() => {
    const created = searchParams.get('created');
    const updated = searchParams.get('updated');
    if (created) setSuccessModal('created');
    else if (updated) setSuccessModal('updated');
    // Clean up URL params
    if (created || updated) {
      window.history.replaceState({}, '', '/dashboard');
    }
  }, [searchParams]);

  // Redirect if not logged in
  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  // Buyers belong on /buyer-dashboard, not the agent dashboard
  useEffect(() => {
    if (!loading && userData && isBuyerOnly(userData)) {
      router.replace('/buyer-dashboard');
    }
  }, [loading, userData, router]);

  // Real-time properties listener
  useEffect(() => {
    if (!user) return;
    setPropertiesLoading(true);
    const q = query(collection(db, 'properties'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'));
    let isFirst = true;
    const unsub = onSnapshot(q, async (snapshot) => {
      const props = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setProperties(props);
      if (isFirst) {
        setPropertiesLoading(false);
        isFirst = false;
        // Fetch buyer opinions count once
        const propertyIds = props.map(p => p.id);
        if (propertyIds.length > 0) {
          let totalOpinions = 0;
          for (let i = 0; i < propertyIds.length; i += 30) {
            const batch = propertyIds.slice(i, i + 30);
            const offersSnap = await getDocs(
              query(collection(db, 'offers'), where('propertyId', 'in', batch))
            );
            totalOpinions += offersSnap.docs.filter(d => d.data().type === 'opinion').length;
          }
          setOpinionsCount(totalOpinions);
        }
      }
    }, (err) => {
      console.error('Error fetching properties:', err);
      setPropertiesLoading(false);
    });
    return () => unsub();
  }, [user]);

  // Fetch team agents
  useEffect(() => {
    if (!user) return;
    const fetchAgents = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'agents'), where('userId', '==', user.uid)));
        setTeamAgents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Error fetching agents:', err);
      }
    };
    fetchAgents();
  }, [user]);

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  const toggleVisibility = async (property) => {
    setToggling(true);
    try {
      const newVisibility = !property.visibility;
      await updateDoc(doc(db, 'properties', property.id), { visibility: newVisibility });
      setProperties(prev =>
        prev.map(p => p.id === property.id ? { ...p, visibility: newVisibility } : p)
      );
    } catch (err) {
      console.error('Error toggling visibility:', err);
    } finally {
      setToggling(false);
    }
  };

  const archiveProperty = async (property) => {
    setArchiving(true);
    try {
      await updateDoc(doc(db, 'properties', property.id), { archived: true, visibility: false });
      setProperties(prev =>
        prev.map(p => p.id === property.id ? { ...p, archived: true, visibility: false } : p)
      );
    } catch (err) {
      console.error('Error archiving property:', err);
    } finally {
      setArchiving(false);
    }
  };

  const unarchiveProperty = async (property) => {
    setArchiving(true);
    try {
      await updateDoc(doc(db, 'properties', property.id), { archived: false });
      setProperties(prev =>
        prev.map(p => p.id === property.id ? { ...p, archived: false } : p)
      );
    } catch (err) {
      console.error('Error unarchiving property:', err);
    } finally {
      setArchiving(false);
    }
  };

  const handleHideProperty = async (property) => {
    try {
      await updateDoc(doc(db, 'properties', property.id), { hidden: true });
      setProperties(prev => prev.filter(p => p.id !== property.id));
    } catch (err) {
      console.error('Error hiding property:', err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    );
  }

  if (!user) return null;

  const userName = [userData?.firstName, userData?.lastName].filter(Boolean).join(' ') || 'Agent';
  const activeProperties = properties.filter(p => p.archived !== true && p.hidden !== true);
  // Sold is a distinct reason for being archived — kept separate from the
  // general Archive tab so the two features don't overlap.
  const soldProperties = properties.filter(p => p.archived === true && p.archivedReason === 'sold' && p.hidden !== true);
  const archivedProperties = properties.filter(p => p.archived === true && p.archivedReason !== 'sold' && p.hidden !== true);
  const liveProperties = activeProperties.filter(p => p.visibility === true);
  const totalViews = activeProperties.reduce((sum, p) => sum + (p.stats?.views || 0), 0);
  const currentTabProperties = activeTab === 'sold' ? soldProperties : activeTab === 'archived' ? archivedProperties : activeProperties;
  const agentFilteredProperties = filterAgentId
    ? currentTabProperties.filter(p => p.agentId === filterAgentId)
    : currentTabProperties;
  const displayProperties = agentFilteredProperties;

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar
        active={activeTab}
        onNavigate={setActiveTab}
        onSignOut={handleSignOut}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        userName={userName}
        userData={userData}
      />

      {/* Main Content */}
      <div className="lg:pl-64">
        {/* Mobile Header */}
        <div className="sticky top-0 z-20 bg-white border-b border-slate-200 lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <button onClick={() => setSidebarOpen(true)} className="p-2 hover:bg-slate-100 rounded-lg">
              <Menu className="w-5 h-5 text-slate-700" />
            </button>
            <span className="text-lg font-bold text-slate-900">Dashboard</span>
            <Link href="/dashboard/add" className="p-2 hover:bg-slate-100 rounded-lg">
              <Plus className="w-5 h-5 text-slate-700" />
            </Link>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          <DownloadBanner />

          {/* Page Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                {activeTab === 'archived' ? 'Archived Properties' : activeTab === 'sold' ? 'Sold Properties' : 'Dashboard'}
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                {activeTab === 'archived'
                  ? `${archivedProperties.length} ${archivedProperties.length === 1 ? 'property' : 'properties'}`
                  : activeTab === 'sold'
                  ? `${soldProperties.length} ${soldProperties.length === 1 ? 'property' : 'properties'}`
                  : userData?.companyName
                    ? `Welcome back, ${userData.companyName}`
                    : <span>Welcome back! <Link href="/dashboard/settings" className="text-orange-500 hover:text-orange-600 font-semibold">Add Agency Details</Link></span>}
              </p>
            </div>
            <Link
              href="/dashboard/add"
              className="hidden sm:inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-semibold text-sm rounded-xl shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 transition-all"
            >
              <Plus className="w-4 h-4" />
              Add Property
            </Link>
          </div>

          {/* Agent Filter */}
          {teamAgents.length > 0 && (
            <div className="flex items-center gap-3">
              <select
                value={filterAgentId}
                onChange={(e) => setFilterAgentId(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400"
              >
                <option value="">All agents</option>
                {teamAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Overview Stats */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Total Properties" value={propertiesLoading ? '...' : activeProperties.length} icon={Home} />
              <StatCard label="Public Listings" value={propertiesLoading ? '...' : liveProperties.length} icon={TrendingUp} />
              <StatCard label="Total Views" value={propertiesLoading ? '...' : totalViews} icon={Eye} />
              <StatCard label="Buyer Opinions" value={propertiesLoading ? '...' : opinionsCount} icon={MessageSquare} />
            </div>
          )}

          {/* Quick Actions (overview only) */}
          {activeTab === 'overview' && !propertiesLoading && properties.length > 0 && (
            <Link
              href="/dashboard/add"
              className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4 hover:shadow-md transition-shadow group"
            >
              <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center group-hover:bg-slate-200 transition-colors">
                <Plus className="w-6 h-6 text-slate-600" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-slate-900">Add Property</p>
                <p className="text-xs text-slate-500">List a new property for your client</p>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-300" />
            </Link>
          )}

          {/* Properties Grid */}
          {propertiesLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
            </div>
          ) : activeTab !== 'archived' && activeTab !== 'sold' && properties.length === 0 ? (
            <EmptyState />
          ) : displayProperties.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              {activeTab === 'sold' ? (
                <>
                  <CheckCircle className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">No sold properties yet</p>
                </>
              ) : (
                <>
                  <Archive className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">No archived properties</p>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {displayProperties.map(property => (
                <PropertyCard
                  key={property.id}
                  property={property}
                  onToggleVisibility={toggleVisibility}
                  toggling={toggling}
                  onArchive={(activeTab === 'archived' || activeTab === 'sold') ? unarchiveProperty : archiveProperty}
                  archiving={archiving}
                  isArchived={property.archived === true}
                  isSold={property.archivedReason === 'sold'}
                  onHide={handleHideProperty}
                  teamAgents={teamAgents}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Logo Upload Modal */}
      <AnimatePresence>
        {showLogoModal && (
          <LogoUploadModal
            show={showLogoModal}
            onClose={() => setShowLogoModal(false)}
            user={user}
            userData={userData}
            setUserData={setUserData}
          />
        )}
      </AnimatePresence>

      {/* Logo Nudge */}
      <AnimatePresence>
        {(userData?.isAgent || userData?.agent) && !userData?.logoUrl && !showLogoModal && (
          <LogoNudge onClick={() => setShowLogoModal(true)} />
        )}
      </AnimatePresence>

      {/* Success Modal */}
      <AnimatePresence>
        {successModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setSuccessModal(null); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
            >
              {/* Green header */}
              <div className="bg-gradient-to-r from-emerald-500 to-green-500 px-8 pt-8 pb-6 text-center">
                <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-9 h-9 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-white">
                  {successModal === 'created' ? 'Property Created!' : 'Changes Saved!'}
                </h2>
              </div>

              {/* Body */}
              <div className="px-8 py-6 space-y-5">
                {/* Upload status */}
                <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Upload className="w-4 h-4 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-amber-900">Media uploading in the background</p>
                    <p className="text-xs text-amber-700 mt-1">Your photos and video are being uploaded. This may take a minute depending on file sizes. You can keep using the dashboard while this happens.</p>
                  </div>
                </div>

                {/* Visibility info */}
                <div className="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Eye className="w-4 h-4 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Your listing is set to Private</p>
                    <p className="text-xs text-slate-600 mt-1">
                      {successModal === 'created'
                        ? 'New listings start as private so you can review everything first. When you\'re ready for buyers to see it, tap the'
                        : 'Your listing is currently private. To make it visible to buyers, tap the'
                      }
                      {' '}<span className="font-semibold text-emerald-600">Set Public</span> button on your property card.
                    </p>
                  </div>
                </div>

                {/* Action button */}
                <button
                  onClick={() => setSuccessModal(null)}
                  className="w-full py-3 bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-semibold rounded-xl shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40 transition-all text-sm"
                >
                  Got it
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
