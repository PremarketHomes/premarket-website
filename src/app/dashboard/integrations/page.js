'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import { useRequireAgent } from '../../hooks/useRequireAgent';
import { authFetch } from '../../utils/authFetch';
import {
  ArrowLeft,
  Plug,
  Link2,
  Unlink,
  RefreshCw,
  Check,
  X,
  AlertCircle,
  Home,
  Bed,
  Bath,
  Car,
  Eye,
  EyeOff,
  Search,
  Loader2,
  ChevronDown,
  ExternalLink,
  Clock,
  CheckCircle2,
  XCircle,
  Import,
  Building2,
} from 'lucide-react';

// --- Agentbox Connect Modal ---
function ConnectModal({ onClose, onConnect, onConnectDemo, connecting }) {
  const [clientId, setClientId] = useState('');
  const [apiKey, setApiKey] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (clientId.trim() && apiKey.trim()) {
      onConnect(clientId.trim(), apiKey.trim());
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Connect Agentbox</h2>
              <p className="text-xs text-slate-500">Enter your CRM credentials</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Client ID</label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Your Agentbox Client ID"
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Your Agentbox API Key"
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
              required
            />
          </div>

          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-xs text-slate-500">
              Contact your Agentbox administrator or email{' '}
              <span className="font-medium text-slate-700">integration@agentbox.com.au</span>{' '}
              to obtain your API credentials.
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={connecting || !clientId.trim() || !apiKey.trim()}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-[#e48900] to-[#c64500] rounded-xl shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 transition-all disabled:opacity-50"
            >
              {connecting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Link2 className="w-4 h-4" />
                  Connect &amp; Verify
                </>
              )}
            </button>
          </div>
        </form>

        <div className="mt-4 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onConnectDemo}
            disabled={connecting}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-slate-600 bg-white border border-dashed border-slate-300 hover:bg-slate-50 hover:border-slate-400 rounded-xl transition-all disabled:opacity-50"
          >
            <Building2 className="w-4 h-4" />
            Use Demo Data (12 test properties)
          </button>
          <p className="text-[11px] text-slate-400 text-center mt-2">Try out the integration with sample Australian properties — no credentials needed.</p>
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- Rex Connect Modal ---
function RexConnectModal({ onClose, onConnect, onConnectDemo, connecting }) {
  const [accountId, setAccountId] = useState('');
  const [apiSecret, setApiSecret] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (accountId.trim() && apiSecret.trim()) {
      onConnect(accountId.trim(), apiSecret.trim());
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
              <span className="text-sm font-bold text-white">RX</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Connect Rex</h2>
              <p className="text-xs text-slate-500">Enter your Rex API credentials</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Account ID</label>
            <input
              type="text"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="Your Rex Account ID"
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">API Secret</label>
            <input
              type="password"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder="Your Rex API Secret"
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              required
            />
          </div>

          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-xs text-slate-500">
              Contact your Rex administrator or visit{' '}
              <span className="font-medium text-slate-700">rexsoftware.com</span>{' '}
              to obtain your API credentials.
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={connecting || !accountId.trim() || !apiSecret.trim()}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 transition-all disabled:opacity-50"
            >
              {connecting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Link2 className="w-4 h-4" />
                  Connect &amp; Verify
                </>
              )}
            </button>
          </div>
        </form>

        <div className="mt-4 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onConnectDemo}
            disabled={connecting}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-slate-600 bg-white border border-dashed border-slate-300 hover:bg-slate-50 hover:border-slate-400 rounded-xl transition-all disabled:opacity-50"
          >
            <Building2 className="w-4 h-4" />
            Use Demo Data (12 test properties)
          </button>
          <p className="text-[11px] text-slate-400 text-center mt-2">Try out the Rex integration with sample Australian properties — no credentials needed.</p>
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- Listing Card ---
function ListingCard({ listing, onImport, onToggle, importing, source }) {
  const isImported = listing._imported;
  const premarket = listing._premarket;
  const isLive = premarket?.visibility === true;

  // Handle both AgentBox and Rex image formats
  const images = listing.images || listing.photos || [];
  const imageUrl = images[0]?.url || images[0]?.uri || images[0]?.original || images[0]?.medium || (typeof images[0] === 'string' ? images[0] : null);

  // Handle both AgentBox and Rex address formats
  let address, suburb;
  if (source === 'rex') {
    const prop = listing.property || {};
    address = [prop.adr_unit_number, prop.adr_street_number, prop.adr_street_name].filter(Boolean).join(' ');
    suburb = prop.adr_suburb_or_town || '';
  } else {
    address = listing.streetAddress || listing.address?.street ||
      [listing.unitNumber, listing.streetNumber, listing.streetName].filter(Boolean).join(' ');
    suburb = listing.suburb || listing.address?.suburb || '';
  }
  const fullAddress = [address, suburb].filter(Boolean).join(', ');

  // Handle both AgentBox and Rex price formats
  const price = source === 'rex'
    ? (listing.price_match || listing.price_advertise_as || '')
    : (listing.displayPrice || listing.price || listing.searchPrice || '');

  // Handle both AgentBox and Rex attribute names
  const bedrooms = source === 'rex' ? listing.attr_bedrooms : listing.bedrooms;
  const bathrooms = source === 'rex' ? listing.attr_bathrooms : listing.bathrooms;
  const carSpaces = source === 'rex' ? (listing.attr_garages || listing.attr_carspaces) : (listing.carSpaces || listing.garages);
  const propertyType = source === 'rex' ? listing.property_category : listing.type;

  const badgeLabel = source === 'rex' ? 'Rex' : 'Agentbox';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-lg transition-shadow"
    >
      {/* Image */}
      <div className="relative h-44 bg-slate-100">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={fullAddress || 'Property'}
            fill
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Home className="w-12 h-12 text-slate-300" />
          </div>
        )}
        {/* Source Badge */}
        <div className="absolute top-3 left-3">
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full text-white ${
            source === 'rex' ? 'bg-blue-600' : 'bg-slate-900'
          }`}>
            {badgeLabel}
          </span>
        </div>
        {/* Status Badge */}
        {isImported && (
          <div className="absolute top-3 right-3">
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full ${
              isLive ? 'bg-emerald-500 text-white' : 'bg-white text-slate-600'
            }`}>
              {isLive ? 'Live on Premarket' : 'Draft'}
            </span>
          </div>
        )}
      </div>

      {/* Details */}
      <div className="p-4">
        <p className="font-semibold text-slate-900 text-sm truncate mb-1">{fullAddress || 'No address'}</p>
        <p className="text-lg font-bold text-slate-900 mb-2">
          {typeof price === 'number' ? `$${price.toLocaleString('en-AU')}` : price || '--'}
        </p>

        <div className="flex items-center gap-3 text-xs text-slate-500 mb-4">
          {bedrooms != null && (
            <span className="flex items-center gap-1"><Bed className="w-3.5 h-3.5" />{bedrooms}</span>
          )}
          {bathrooms != null && (
            <span className="flex items-center gap-1"><Bath className="w-3.5 h-3.5" />{bathrooms}</span>
          )}
          {carSpaces != null && carSpaces > 0 && (
            <span className="flex items-center gap-1"><Car className="w-3.5 h-3.5" />{carSpaces}</span>
          )}
          {propertyType && (
            <span className="text-slate-400">{propertyType}</span>
          )}
        </div>

        {/* Actions */}
        {isImported ? (
          <div className="flex gap-2">
            <Link
              href={`/dashboard/property/${premarket.propertyId}`}
              className="flex-1 text-center px-3 py-2.5 text-xs font-semibold text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-lg transition-colors"
            >
              View Report
            </Link>
            <button
              onClick={() => onToggle(premarket.propertyId, !isLive)}
              className={`px-3 py-2.5 text-xs font-semibold rounded-lg transition-colors ${
                isLive
                  ? 'text-slate-600 bg-slate-50 hover:bg-slate-100'
                  : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
              }`}
            >
              {isLive ? 'Set Draft' : 'Go Live'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => onImport(listing.id)}
            disabled={importing}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
          >
            {importing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Import className="w-3.5 h-3.5" />
            )}
            Import to Premarket
          </button>
        )}
      </div>
    </motion.div>
  );
}

// --- CRM Card ---
function CrmCard({ name, logo, description, status, onConnect, comingSoon }) {
  return (
    <div className={`bg-white border rounded-xl p-6 transition-all ${
      comingSoon ? 'border-slate-100 opacity-60' : 'border-slate-200 hover:shadow-md'
    }`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-lg font-bold text-slate-600">
            {logo}
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">{name}</h3>
            <p className="text-xs text-slate-500">{description}</p>
          </div>
        </div>
        {status === 'connected' && (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="w-3 h-3" />
            Connected
          </span>
        )}
      </div>

      {comingSoon ? (
        <div className="text-center py-2">
          <span className="text-xs font-medium text-slate-400">Coming Soon</span>
        </div>
      ) : status === 'connected' ? (
        <button
          onClick={onConnect}
          className="w-full px-4 py-2.5 text-sm font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors"
        >
          Manage Connection
        </button>
      ) : (
        <button
          onClick={onConnect}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-[#e48900] to-[#c64500] rounded-xl shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 transition-all"
        >
          <Plug className="w-4 h-4" />
          Connect
        </button>
      )}
    </div>
  );
}

// --- Main Page ---
export default function IntegrationsPage() {
  useRequireAgent();
  const { user, userData, loading } = useAuth();
  const router = useRouter();

  // Agentbox state
  const [integration, setIntegration] = useState(null);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

  // Rex state
  const [rexIntegration, setRexIntegration] = useState(null);
  const [showRexConnectModal, setShowRexConnectModal] = useState(false);
  const [rexConnecting, setRexConnecting] = useState(false);
  const [rexConnectError, setRexConnectError] = useState('');

  // Listings state (shared between views — only one active at a time)
  const [listings, setListings] = useState([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [importing, setImporting] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState(null);

  // Rex listings state
  const [rexListings, setRexListings] = useState([]);
  const [rexListingsLoading, setRexListingsLoading] = useState(false);
  const [rexSearchQuery, setRexSearchQuery] = useState('');
  const [rexImporting, setRexImporting] = useState(null);
  const [rexSyncing, setRexSyncing] = useState(false);

  // View state
  const [view, setView] = useState('hub'); // 'hub' | 'agentbox' | 'rex'

  useEffect(() => {
    if (!loading && !user) {
      router.push('/join');
    }
  }, [user, loading, router]);

  // Load integration connection status via an authenticated API route
  // rather than reading the users document directly — credentials now
  // live in a server-only collection, so there's nothing for the client
  // SDK to read here even for the account owner (see security audit,
  // Finding 3). Re-fetched after every connect/disconnect/sync action.
  const fetchIntegrationStatus = useCallback(async () => {
    if (!user) return;
    try {
      const res = await authFetch('/api/integrations/status');
      if (!res.ok) return;
      const data = await res.json();
      setIntegration(data.agentbox || null);
      setRexIntegration(data.rex || null);
    } catch (err) {
      console.error('Failed to load integration status:', err);
    }
  }, [user]);

  useEffect(() => {
    fetchIntegrationStatus();
  }, [fetchIntegrationStatus]);

  // Fetch Agentbox listings when connected and viewing agentbox
  const fetchListings = useCallback(async () => {
    if (!user || integration?.status !== 'connected') return;
    setListingsLoading(true);
    try {
      const res = await authFetch(`/api/integrations/agentbox/listings?uid=${user.uid}&limit=100`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setListings(data.listings || []);
    } catch (err) {
      console.error('Failed to fetch listings:', err);
      showToast('Failed to load listings', 'error');
    } finally {
      setListingsLoading(false);
    }
  }, [user, integration?.status]);

  // Fetch Rex listings when connected and viewing rex
  const fetchRexListings = useCallback(async () => {
    if (!user || rexIntegration?.status !== 'connected') return;
    setRexListingsLoading(true);
    try {
      const res = await authFetch(`/api/integrations/rex/listings?uid=${user.uid}&limit=100`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setRexListings(data.listings || []);
    } catch (err) {
      console.error('Failed to fetch Rex listings:', err);
      showToast('Failed to load Rex listings', 'error');
    } finally {
      setRexListingsLoading(false);
    }
  }, [user, rexIntegration?.status]);

  useEffect(() => {
    if (view === 'agentbox' && integration?.status === 'connected') {
      fetchListings();
    }
  }, [view, integration?.status, fetchListings]);

  useEffect(() => {
    if (view === 'rex' && rexIntegration?.status === 'connected') {
      fetchRexListings();
    }
  }, [view, rexIntegration?.status, fetchRexListings]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // --- Agentbox handlers ---
  const handleConnect = async (clientId, apiKey) => {
    setConnecting(true);
    setConnectError('');
    try {
      const res = await authFetch('/api/integrations/agentbox/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid, clientId, apiKey }),
      });
      const data = await res.json();

      if (!res.ok) {
        setConnectError(data.error || 'Failed to connect');
        return;
      }

      setShowConnectModal(false);
      setView('agentbox');
      showToast('Connected to Agentbox successfully');
      fetchIntegrationStatus();
    } catch (err) {
      console.error(err);
      setConnectError('Connection failed. Please check your credentials.');
    } finally {
      setConnecting(false);
    }
  };

  const handleConnectDemo = async () => {
    setConnecting(true);
    setConnectError('');
    try {
      const res = await authFetch('/api/integrations/agentbox/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid, demo: true }),
      });
      const data = await res.json();

      if (!res.ok) {
        setConnectError(data.error || 'Failed to connect demo');
        return;
      }

      setShowConnectModal(false);
      setView('agentbox');
      showToast('Connected with demo data');
      fetchIntegrationStatus();
    } catch (err) {
      console.error(err);
      setConnectError('Demo connection failed.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect from Agentbox? Your imported properties will remain but syncing will stop.')) return;
    try {
      const res = await authFetch('/api/integrations/agentbox/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid }),
      });
      if (!res.ok) throw new Error('Failed to disconnect');
      setView('hub');
      showToast('Disconnected from Agentbox');
      fetchIntegrationStatus();
    } catch (err) {
      console.error(err);
      showToast('Failed to disconnect', 'error');
    }
  };

  const handleImport = async (listingId) => {
    setImporting(listingId);
    try {
      const res = await authFetch('/api/integrations/agentbox/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid, listingIds: [String(listingId)] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to import');

      showToast(`Imported ${data.imported} listing${data.imported !== 1 ? 's' : ''}`);
      await fetchListings();
    } catch (err) {
      console.error(err);
      showToast('Failed to import listing', 'error');
    } finally {
      setImporting(null);
    }
  };

  const handleImportAll = async () => {
    const unimported = filteredListings.filter(l => !l._imported);
    if (unimported.length === 0) return;

    const batch = unimported.slice(0, 20);
    setImporting('all');
    try {
      const res = await authFetch('/api/integrations/agentbox/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid, listingIds: batch.map(l => String(l.id)) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to import');

      showToast(`Imported ${data.imported} listing${data.imported !== 1 ? 's' : ''}`);
      await fetchListings();
    } catch (err) {
      console.error(err);
      showToast('Failed to import listings', 'error');
    } finally {
      setImporting(null);
    }
  };

  const handleToggle = async (propertyId, visibility) => {
    try {
      const res = await authFetch(`/api/integrations/agentbox/toggle/${propertyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid, visibility }),
      });
      if (!res.ok) throw new Error('Failed to toggle');
      await fetchListings();
      showToast(visibility ? 'Property is now live' : 'Property set to draft');
    } catch (err) {
      console.error(err);
      showToast('Failed to update property', 'error');
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await authFetch('/api/integrations/agentbox/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to sync');

      showToast(`Synced ${data.updated} properties`);
      await fetchListings();
      fetchIntegrationStatus();
    } catch (err) {
      console.error(err);
      showToast('Sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  };

  // --- Rex handlers ---
  const handleRexConnect = async (accountId, apiSecret) => {
    setRexConnecting(true);
    setRexConnectError('');
    try {
      const res = await authFetch('/api/integrations/rex/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid, clientId: accountId, clientSecret: apiSecret }),
      });
      const data = await res.json();

      if (!res.ok) {
        setRexConnectError(data.error || 'Failed to connect');
        return;
      }

      setShowRexConnectModal(false);
      setView('rex');
      showToast('Connected to Rex successfully');
      fetchIntegrationStatus();
    } catch (err) {
      console.error(err);
      setRexConnectError('Connection failed. Please check your credentials.');
    } finally {
      setRexConnecting(false);
    }
  };

  const handleRexConnectDemo = async () => {
    setRexConnecting(true);
    setRexConnectError('');
    try {
      const res = await authFetch('/api/integrations/rex/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid, demo: true }),
      });
      const data = await res.json();

      if (!res.ok) {
        setRexConnectError(data.error || 'Failed to connect demo');
        return;
      }

      setShowRexConnectModal(false);
      setView('rex');
      showToast('Connected to Rex with demo data');
      fetchIntegrationStatus();
    } catch (err) {
      console.error(err);
      setRexConnectError('Demo connection failed.');
    } finally {
      setRexConnecting(false);
    }
  };

  const handleRexDisconnect = async () => {
    if (!confirm('Disconnect from Rex? Your imported properties will remain but syncing will stop.')) return;
    try {
      const res = await authFetch('/api/integrations/rex/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid }),
      });
      if (!res.ok) throw new Error('Failed to disconnect');
      setView('hub');
      showToast('Disconnected from Rex');
      fetchIntegrationStatus();
    } catch (err) {
      console.error(err);
      showToast('Failed to disconnect', 'error');
    }
  };

  const handleRexImport = async (listingId) => {
    setRexImporting(listingId);
    try {
      const res = await authFetch('/api/integrations/rex/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid, listingIds: [String(listingId)] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to import');

      showToast(`Imported ${data.imported} listing${data.imported !== 1 ? 's' : ''}`);
      await fetchRexListings();
    } catch (err) {
      console.error(err);
      showToast('Failed to import listing', 'error');
    } finally {
      setRexImporting(null);
    }
  };

  const handleRexImportAll = async () => {
    const unimported = filteredRexListings.filter(l => !l._imported);
    if (unimported.length === 0) return;

    const batch = unimported.slice(0, 20);
    setRexImporting('all');
    try {
      const res = await authFetch('/api/integrations/rex/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid, listingIds: batch.map(l => String(l.id)) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to import');

      showToast(`Imported ${data.imported} listing${data.imported !== 1 ? 's' : ''}`);
      await fetchRexListings();
    } catch (err) {
      console.error(err);
      showToast('Failed to import listings', 'error');
    } finally {
      setRexImporting(null);
    }
  };

  const handleRexToggle = async (propertyId, visibility) => {
    try {
      const res = await authFetch(`/api/integrations/rex/toggle/${propertyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid, visibility }),
      });
      if (!res.ok) throw new Error('Failed to toggle');
      await fetchRexListings();
      showToast(visibility ? 'Property is now live' : 'Property set to draft');
    } catch (err) {
      console.error(err);
      showToast('Failed to update property', 'error');
    }
  };

  const handleRexSync = async () => {
    setRexSyncing(true);
    try {
      const res = await authFetch('/api/integrations/rex/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to sync');

      showToast(`Synced ${data.updated} properties`);
      await fetchRexListings();
      fetchIntegrationStatus();
    } catch (err) {
      console.error(err);
      showToast('Sync failed', 'error');
    } finally {
      setRexSyncing(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    );
  }

  const isConnected = integration?.status === 'connected';
  const isRexConnected = rexIntegration?.status === 'connected';

  // Filter Agentbox listings by search
  const filteredListings = listings.filter((l) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const addr = (l.streetAddress || l.address?.street || '').toLowerCase();
    const sub = (l.suburb || l.address?.suburb || '').toLowerCase();
    return addr.includes(q) || sub.includes(q);
  });

  const importedCount = filteredListings.filter(l => l._imported).length;
  const unimportedCount = filteredListings.filter(l => !l._imported).length;

  // Filter Rex listings by search
  const filteredRexListings = rexListings.filter((l) => {
    if (!rexSearchQuery) return true;
    const q = rexSearchQuery.toLowerCase();
    const prop = l.property || {};
    const addr = [prop.adr_street_number, prop.adr_street_name].filter(Boolean).join(' ').toLowerCase();
    const sub = (prop.adr_suburb_or_town || '').toLowerCase();
    const headline = (l.headline || '').toLowerCase();
    return addr.includes(q) || sub.includes(q) || headline.includes(q);
  });

  const rexImportedCount = filteredRexListings.filter(l => l._imported).length;
  const rexUnimportedCount = filteredRexListings.filter(l => !l._imported).length;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-4">
          {view === 'agentbox' || view === 'rex' ? (
            <button onClick={() => setView('hub')} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
          ) : (
            <Link href="/dashboard" className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </Link>
          )}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-[#e48900] to-[#c64500] rounded-lg flex items-center justify-center">
              <Plug className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">
              {view === 'agentbox' ? 'Agentbox' : view === 'rex' ? 'Rex' : 'Integrations'}
            </h1>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* --- HUB VIEW --- */}
        {view === 'hub' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900 mb-1">CRM Integrations</h2>
              <p className="text-sm text-slate-500">
                Connect your CRM to sync listings to Premarket and start collecting buyer insights.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <CrmCard
                name="Agentbox (Reapit)"
                logo="AB"
                description="Sync your Agentbox listings"
                status={isConnected ? 'connected' : 'disconnected'}
                onConnect={() => isConnected ? setView('agentbox') : setShowConnectModal(true)}
              />
              <CrmCard
                name="Rex"
                logo="RX"
                description="Sync your Rex listings"
                status={isRexConnected ? 'connected' : 'disconnected'}
                onConnect={() => isRexConnected ? setView('rex') : setShowRexConnectModal(true)}
              />
              <CrmCard
                name="Vault RE"
                logo="VR"
                description="Sync your Vault RE listings"
                comingSoon
              />
            </div>

            {/* How it works */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-xl border border-slate-200 p-6"
            >
              <h3 className="font-semibold text-slate-900 mb-4">How it works</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {[
                  { step: '1', title: 'Connect', desc: 'Enter your CRM credentials to securely link your account.' },
                  { step: '2', title: 'Import Listings', desc: 'Browse your CRM listings and choose which ones to add to Premarket.' },
                  { step: '3', title: 'Collect Insights', desc: 'Imported listings start collecting buyer opinions and market data.' },
                ].map((item) => (
                  <div key={item.step} className="flex gap-4">
                    <div className="w-8 h-8 bg-orange-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-orange-600">{item.step}</span>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900 text-sm">{item.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        )}

        {/* --- AGENTBOX VIEW --- */}
        {view === 'agentbox' && (
          <div className="space-y-6">
            {/* Connection Status Bar */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                    Connected to Agentbox
                    {integration?.mode === 'demo' && (
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 rounded-full uppercase">Demo</span>
                    )}
                  </p>
                  {integration?.lastSync && (
                    <p className="text-xs text-slate-500">
                      Last synced: {new Date(integration.lastSync?.seconds ? integration.lastSync.seconds * 1000 : integration.lastSync).toLocaleString('en-AU')}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? 'Syncing...' : 'Sync Now'}
                </button>
                <button
                  onClick={handleDisconnect}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                >
                  <Unlink className="w-4 h-4" />
                  Disconnect
                </button>
              </div>
            </div>

            {/* Search & Filter Bar */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 relative min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search listings by address..."
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 bg-white transition-all"
                />
              </div>
              {unimportedCount > 0 && (
                <button
                  onClick={handleImportAll}
                  disabled={importing === 'all'}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-[#e48900] to-[#c64500] rounded-xl shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 transition-all disabled:opacity-50"
                >
                  {importing === 'all' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Import className="w-4 h-4" />
                  )}
                  Import All ({unimportedCount})
                </button>
              )}
            </div>

            {/* Stats */}
            <div className="flex gap-3">
              <div className="bg-white rounded-lg border border-slate-200 px-4 py-2">
                <span className="text-xs text-slate-500">Total</span>
                <span className="ml-2 text-sm font-bold text-slate-900">{filteredListings.length}</span>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 px-4 py-2">
                <span className="text-xs text-slate-500">On Premarket</span>
                <span className="ml-2 text-sm font-bold text-emerald-600">{importedCount}</span>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 px-4 py-2">
                <span className="text-xs text-slate-500">Not Imported</span>
                <span className="ml-2 text-sm font-bold text-slate-600">{unimportedCount}</span>
              </div>
            </div>

            {/* Listings Grid */}
            {listingsLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="text-center">
                  <Loader2 className="w-8 h-8 animate-spin text-orange-500 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">Fetching your Agentbox listings...</p>
                </div>
              </div>
            ) : filteredListings.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Home className="w-8 h-8 text-slate-300" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">
                  {searchQuery ? 'No listings match your search' : 'No listings found'}
                </h3>
                <p className="text-sm text-slate-500">
                  {searchQuery
                    ? 'Try a different search term.'
                    : 'Your Agentbox account doesn\'t have any active listings.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredListings.map((listing) => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    source="agentbox"
                    onImport={handleImport}
                    onToggle={handleToggle}
                    importing={importing === listing.id || importing === 'all'}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* --- REX VIEW --- */}
        {view === 'rex' && (
          <div className="space-y-6">
            {/* Connection Status Bar */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                    Connected to Rex
                    {rexIntegration?.mode === 'demo' && (
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 rounded-full uppercase">Demo</span>
                    )}
                  </p>
                  {rexIntegration?.lastSync && (
                    <p className="text-xs text-slate-500">
                      Last synced: {new Date(rexIntegration.lastSync?.seconds ? rexIntegration.lastSync.seconds * 1000 : rexIntegration.lastSync).toLocaleString('en-AU')}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRexSync}
                  disabled={rexSyncing}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${rexSyncing ? 'animate-spin' : ''}`} />
                  {rexSyncing ? 'Syncing...' : 'Sync Now'}
                </button>
                <button
                  onClick={handleRexDisconnect}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                >
                  <Unlink className="w-4 h-4" />
                  Disconnect
                </button>
              </div>
            </div>

            {/* Search & Filter Bar */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 relative min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={rexSearchQuery}
                  onChange={(e) => setRexSearchQuery(e.target.value)}
                  placeholder="Search listings by address..."
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white transition-all"
                />
              </div>
              {rexUnimportedCount > 0 && (
                <button
                  onClick={handleRexImportAll}
                  disabled={rexImporting === 'all'}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 transition-all disabled:opacity-50"
                >
                  {rexImporting === 'all' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Import className="w-4 h-4" />
                  )}
                  Import All ({rexUnimportedCount})
                </button>
              )}
            </div>

            {/* Stats */}
            <div className="flex gap-3">
              <div className="bg-white rounded-lg border border-slate-200 px-4 py-2">
                <span className="text-xs text-slate-500">Total</span>
                <span className="ml-2 text-sm font-bold text-slate-900">{filteredRexListings.length}</span>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 px-4 py-2">
                <span className="text-xs text-slate-500">On Premarket</span>
                <span className="ml-2 text-sm font-bold text-emerald-600">{rexImportedCount}</span>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 px-4 py-2">
                <span className="text-xs text-slate-500">Not Imported</span>
                <span className="ml-2 text-sm font-bold text-slate-600">{rexUnimportedCount}</span>
              </div>
            </div>

            {/* Listings Grid */}
            {rexListingsLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="text-center">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">Fetching your Rex listings...</p>
                </div>
              </div>
            ) : filteredRexListings.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Home className="w-8 h-8 text-slate-300" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">
                  {rexSearchQuery ? 'No listings match your search' : 'No listings found'}
                </h3>
                <p className="text-sm text-slate-500">
                  {rexSearchQuery
                    ? 'Try a different search term.'
                    : 'Your Rex account doesn\'t have any active listings.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredRexListings.map((listing) => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    source="rex"
                    onImport={handleRexImport}
                    onToggle={handleRexToggle}
                    importing={rexImporting === listing.id || rexImporting === 'all'}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Agentbox Connect Modal */}
      <AnimatePresence>
        {showConnectModal && (
          <ConnectModal
            onClose={() => { setShowConnectModal(false); setConnectError(''); }}
            onConnect={handleConnect}
            onConnectDemo={handleConnectDemo}
            connecting={connecting}
          />
        )}
      </AnimatePresence>

      {/* Rex Connect Modal */}
      <AnimatePresence>
        {showRexConnectModal && (
          <RexConnectModal
            onClose={() => { setShowRexConnectModal(false); setRexConnectError(''); }}
            onConnect={handleRexConnect}
            onConnectDemo={handleRexConnectDemo}
            connecting={rexConnecting}
          />
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 text-sm font-medium ${
              toast.type === 'error'
                ? 'bg-red-600 text-white'
                : 'bg-slate-900 text-white'
            }`}
          >
            {toast.type === 'error' ? (
              <XCircle className="w-4 h-4" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Connect Error Toast */}
      <AnimatePresence>
        {(connectError || rexConnectError) && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg bg-red-600 text-white flex items-center gap-2 text-sm font-medium"
          >
            <AlertCircle className="w-4 h-4" />
            {connectError || rexConnectError}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
