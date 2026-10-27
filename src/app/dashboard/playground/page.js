'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import { authFetch } from '../../utils/authFetch';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/clientApp';
import {
  ArrowLeft,
  MessageSquare,
  TrendingUp,
  TrendingDown,
  Activity,
  X,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  Clock,
  Sparkles,
  MapPin,
} from 'lucide-react';

import PHITicker from './components/PHITicker';
import HeatmapControls from './components/HeatmapControls';
import LocationSearch from './components/LocationSearch';
import LocationReport from './components/LocationReport';
import ChatPanel from './components/ChatPanel';
import { loginUrlForCurrentPage } from '../../utils/loginRedirect';

// Load mapbox component with SSR disabled (mapbox-gl requires window/document)
const PHIHeatmap = dynamic(() => import('./components/PHIHeatmap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[300px] flex items-center justify-center bg-slate-900 rounded-lg">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-400" />
    </div>
  ),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function scoreColor(score) {
  if (score >= 61) return 'text-emerald-400';
  if (score >= 41) return 'text-amber-400';
  return 'text-red-400';
}

// ─── API Fetcher ────────────────────────────────────────────────────────────

async function apiFetch(endpoint, params, apiKey) {
  const url = new URL(`/api/v1/${endpoint}`, window.location.origin);
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { headers: { 'x-api-key': apiKey } });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// ─── Zoom level by place type ───────────────────────────────────────────────

function zoomForPlaceType(type) {
  switch (type) {
    case 'address': return 16;
    case 'locality': return 13;
    case 'place': return 11;
    case 'region': return 7;
    default: return 12;
  }
}

// ─── Trending Areas Table ───────────────────────────────────────────────────

function TrendingAreasTable({ areas, loading }) {
  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-5 animate-pulse">
        <div className="h-4 bg-slate-700 rounded w-32 mb-4" />
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-6 bg-slate-800 rounded mb-2" />
        ))}
      </div>
    );
  }

  if (!areas || !areas.length) return null;

  return (
    <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-700/50">
        <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-slate-500" />
          Trending Areas
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-900/50 border-b border-slate-700/50">
              <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase">Suburb</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase">Buyer</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase">Seller</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase">MHI</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase">Props</th>
            </tr>
          </thead>
          <tbody>
            {areas.map((area, i) => (
              <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                <td className="px-3 py-2 text-slate-300 font-medium">
                  {area.suburb}{area.state ? `, ${area.state}` : ''}
                </td>
                <td className="px-3 py-2 text-right">
                  <span className={`font-semibold font-mono ${scoreColor(area.buyerScore || 0)}`}>{area.buyerScore || 0}</span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className={`font-semibold font-mono ${scoreColor(area.sellerScore || 0)}`}>{area.sellerScore || 0}</span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className={`font-semibold font-mono ${scoreColor(area.phi?.mhi || 0)}`}>{area.phi?.mhi || '—'}</span>
                </td>
                <td className="px-3 py-2 text-right text-slate-500 font-mono">{area.properties || area.propertyCount || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Upcoming To Market ─────────────────────────────────────────────────────

function UpcomingToMarket({ data, loading }) {
  const [expandedState, setExpandedState] = useState(null);

  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-5 animate-pulse">
        <div className="h-4 bg-slate-700 rounded w-40 mb-4" />
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-6 bg-slate-800 rounded mb-2" />
        ))}
      </div>
    );
  }

  if (!data || !data.states?.length) {
    return (
      <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-8 text-center">
        <Clock className="w-6 h-6 text-slate-600 mx-auto mb-2" />
        <p className="text-xs text-slate-500">No upcoming properties detected</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-slate-500" />
          Upcoming to Market
        </h3>
        <span className="text-[10px] text-slate-500 font-mono">{data.totalUpcoming} total</span>
      </div>
      {data.states.map((st) => (
        <div key={st.state} className="border-b border-slate-800/50 last:border-0">
          <button
            onClick={() => setExpandedState(expandedState === st.state ? null : st.state)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-300">{st.state}</span>
              <span className="text-[10px] text-slate-600">{st.count} props</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-amber-400">{st.avgLikelihood}%</span>
              {expandedState === st.state ? <ChevronUp className="w-3 h-3 text-slate-600" /> : <ChevronDown className="w-3 h-3 text-slate-600" />}
            </div>
          </button>
          {expandedState === st.state && (
            <div className="px-4 pb-3 space-y-2">
              {st.suburbs.map((sub) => (
                <div key={sub.suburb} className="bg-slate-900/50 rounded-md p-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-medium text-slate-300">{sub.suburb}</span>
                    <span className="text-[10px] text-slate-600">{sub.count} &middot; {sub.avgLikelihood}%</span>
                  </div>
                  <div className="space-y-1">
                    {sub.properties.map((p) => (
                      <div key={p.propertyId} className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500 truncate flex-1 mr-2">{p.address || p.propertyId}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {p.signals.seriousBuyers > 0 && (
                            <span className="px-1 py-0.5 bg-emerald-500/20 text-emerald-400 rounded font-mono">
                              {p.signals.seriousBuyers}s
                            </span>
                          )}
                          <span className={`px-1 py-0.5 rounded font-mono ${
                            p.likelihood >= 60 ? 'bg-emerald-500/20 text-emerald-400' :
                            p.likelihood >= 30 ? 'bg-amber-500/20 text-amber-400' :
                            'bg-slate-700 text-slate-400'
                          }`}>
                            {p.likelihood}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function PlaygroundPage() {
  const { user, userData, loading } = useAuth();
  const router = useRouter();
  const [apiAccess, setApiAccess] = useState(null);

  // Chat state
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const mobileInputRef = useRef(null);

  // Dashboard state
  const [nationalData, setNationalData] = useState(null);
  const [nationalLoading, setNationalLoading] = useState(true);
  const [trendingAreas, setTrendingAreas] = useState(null);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [upcomingData, setUpcomingData] = useState(null);
  const [upcomingLoading, setUpcomingLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [dataRange, setDataRange] = useState('90');

  // Map state
  const [selectedMetric, setSelectedMetric] = useState('mhi');
  const [heatmapData, setHeatmapData] = useState(null);
  const [heatmapLoading, setHeatmapLoading] = useState(true);

  // Location report state (replaces old search + selectedSuburb)
  const [activeLocation, setActiveLocation] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [reportLoading, setReportLoading] = useState({});
  const [searchRadius, setSearchRadius] = useState(5);
  const [flyToLocation, setFlyToLocation] = useState(null);
  const [selectedMarker, setSelectedMarker] = useState(null);

  // Generation counter to prevent stale responses
  const reportGenRef = useRef(0);

  useEffect(() => {
    if (!loading && !user) router.replace(loginUrlForCurrentPage());
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (snap.exists()) setApiAccess(snap.data().apiAccess || { status: 'none' });
    });
    return () => unsub();
  }, [user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const apiKey = apiAccess?.apiKey;

  // Fetch initial data
  useEffect(() => {
    if (!apiKey) return;

    apiFetch('national-overview', {}, apiKey)
      .then(setNationalData)
      .catch((err) => console.error('National overview error:', err))
      .finally(() => setNationalLoading(false));

    apiFetch('trending-areas', { limit: 10 }, apiKey)
      .then((data) => setTrendingAreas(data.trendingAreas || []))
      .catch((err) => console.error('Trending areas error:', err))
      .finally(() => setTrendingLoading(false));

    apiFetch('upcoming-to-market', {}, apiKey)
      .then(setUpcomingData)
      .catch((err) => console.error('Upcoming to market error:', err))
      .finally(() => setUpcomingLoading(false));
  }, [apiKey]);

  // Fetch heatmap data when metric changes
  useEffect(() => {
    if (!apiKey) return;
    setHeatmapLoading(true);
    apiFetch('heatmap-data', { metric: selectedMetric }, apiKey)
      .then(setHeatmapData)
      .catch((err) => console.error('Heatmap data error:', err))
      .finally(() => setHeatmapLoading(false));
  }, [apiKey, selectedMetric]);

  // ─── Location Report Fetch ─────────────────────────────────────────────────

  const fetchLocationReport = useCallback((location, seedPhi = null) => {
    if (!apiKey) return;

    const gen = ++reportGenRef.current;
    const params = {
      location: location.suburb || location.name,
      state: location.state,
      radius: searchRadius,
    };

    // Reset report data, seed PHI if available (from map click)
    setReportData(seedPhi ? { phi: seedPhi } : null);
    setReportLoading({
      phi: !seedPhi,
      valuation: true,
      trends: true,
      buyerCompetition: true,
      sellerTiming: true,
      forecast: true,
    });

    // Helper: only update if this is still the current generation
    const update = (key, data) => {
      if (reportGenRef.current !== gen) return;
      setReportData((prev) => ({ ...prev, [key]: data }));
      setReportLoading((prev) => ({ ...prev, [key]: false }));
    };

    const fail = (key) => {
      if (reportGenRef.current !== gen) return;
      setReportLoading((prev) => ({ ...prev, [key]: false }));
    };

    // Fire 6 parallel calls
    apiFetch('phi-scores', params, apiKey)
      .then((d) => update('phi', d))
      .catch(() => fail('phi'));

    apiFetch('property-valuation', params, apiKey)
      .then((d) => update('valuation', d))
      .catch(() => fail('valuation'));

    apiFetch('historical-trends', { ...params, months: 6 }, apiKey)
      .then((d) => update('trends', d.trends || []))
      .catch(() => fail('trends'));

    apiFetch('buyer-competition', params, apiKey)
      .then((d) => update('buyerCompetition', d))
      .catch(() => fail('buyerCompetition'));

    apiFetch('seller-timing', params, apiKey)
      .then((d) => update('sellerTiming', d))
      .catch(() => fail('sellerTiming'));

    apiFetch('market-forecast', params, apiKey)
      .then((d) => update('forecast', d))
      .catch(() => fail('forecast'));
  }, [apiKey, searchRadius]);

  // ─── Location Selection Handlers ───────────────────────────────────────────

  const handleLocationSelect = useCallback((location) => {
    setActiveLocation(location);
    setFlyToLocation({ lng: location.lng, lat: location.lat, zoom: zoomForPlaceType(location.placeType) });
    setSelectedMarker({ lng: location.lng, lat: location.lat });
    fetchLocationReport(location);
  }, [fetchLocationReport]);

  const handleSuburbClick = useCallback((data) => {
    const location = {
      name: data.suburb,
      placeName: `${data.suburb}, ${data.state}`,
      lat: data.lat,
      lng: data.lng,
      placeType: 'locality',
      suburb: data.suburb,
      state: data.state,
    };
    setActiveLocation(location);
    setFlyToLocation({ lng: data.lng, lat: data.lat, zoom: 13 });
    setSelectedMarker({ lng: data.lng, lat: data.lat });

    // Seed with cached PHI from the map
    const seedPhi = data.phi && Object.keys(data.phi).length > 0 ? { phi: data.phi } : null;
    fetchLocationReport(location, seedPhi);
  }, [fetchLocationReport]);

  const handleCloseReport = useCallback(() => {
    reportGenRef.current++;
    setActiveLocation(null);
    setReportData(null);
    setReportLoading({});
    setSelectedMarker(null);
  }, []);

  // Send chat message
  const sendMessage = useCallback(async (text) => {
    const trimmed = (text || chatInput).trim();
    if (!trimmed || sending) return;

    const userMessage = { role: 'user', content: trimmed };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setChatInput('');
    setSending(true);

    try {
      const apiMessages = updatedMessages.map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ messages: apiMessages }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Request failed');
      }
      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setSending(false);
    }
  }, [chatInput, messages, sending, apiKey]);

  const clearChat = () => setMessages([]);

  // Manual sync
  const handleSync = useCallback(async () => {
    if (!apiKey || syncing) return;
    setSyncing(true);
    setSyncResult(null);

    const maxAgeDays = dataRange === 'all' ? undefined : parseInt(dataRange);

    try {
      // compute-scores is now superAdmin-only (verifyAdmin) — it needs
      // the caller's own Firebase session, not the approved-API-client
      // x-api-key every other playground call uses. A non-admin now
      // correctly gets a 403 here instead of being able to trigger a
      // platform-wide recompute.
      const res = await authFetch('/api/admin/compute-scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxAgeDays }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setSyncResult(data);

      // Refresh data
      setNationalLoading(true);
      setTrendingLoading(true);
      setUpcomingLoading(true);
      setHeatmapLoading(true);

      apiFetch('national-overview', {}, apiKey).then(setNationalData).catch(() => {}).finally(() => setNationalLoading(false));
      apiFetch('trending-areas', { limit: 10 }, apiKey).then((d) => setTrendingAreas(d.trendingAreas || [])).catch(() => {}).finally(() => setTrendingLoading(false));
      apiFetch('upcoming-to-market', {}, apiKey).then(setUpcomingData).catch(() => {}).finally(() => setUpcomingLoading(false));
      apiFetch('heatmap-data', { metric: selectedMetric }, apiKey).then(setHeatmapData).catch(() => {}).finally(() => setHeatmapLoading(false));
    } catch (err) {
      setSyncResult({ error: err.message });
    } finally {
      setSyncing(false);
    }
  }, [apiKey, syncing, dataRange, selectedMetric]);

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
      </div>
    );
  }

  if (apiAccess && apiAccess.status !== 'approved') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="w-14 h-14 bg-slate-800 rounded-xl flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="w-7 h-7 text-slate-500" />
          </div>
          <h2 className="text-lg font-bold text-slate-200 mb-2">API Access Required</h2>
          <p className="text-sm text-slate-500 mb-6">
            You need an approved API key to use PHI Intelligence.
          </p>
          <Link
            href="/dashboard/developers"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-600 text-white text-sm font-semibold rounded-lg hover:bg-orange-500 transition-colors"
          >
            Go to Developer Portal
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-200">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 flex-shrink-0 z-10">
        <div className="px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="p-1.5 hover:bg-slate-800 rounded-md transition-colors">
              <ArrowLeft className="w-4 h-4 text-slate-500" />
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-gradient-to-br from-orange-500 to-orange-700 rounded flex items-center justify-center">
                <Activity className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <h1 className="text-xs font-bold text-slate-200 font-mono">PHI Intelligence</h1>
                <p className="text-[10px] text-slate-600">Premarket Health Indicators</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {syncResult && !syncResult.error && (
              <span className="text-[10px] text-emerald-400 font-mono hidden sm:inline">
                {syncResult.computed}/{syncResult.totalSuburbs}
              </span>
            )}
            {syncResult?.error && (
              <span className="text-[10px] text-red-400 font-mono hidden sm:inline">{syncResult.error}</span>
            )}
            <select
              value={dataRange}
              onChange={(e) => setDataRange(e.target.value)}
              className="text-[10px] font-mono rounded border border-slate-700 bg-slate-800 text-slate-400 px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
            >
              <option value="30">30d</option>
              <option value="60">60d</option>
              <option value="90">90d</option>
              <option value="180">6m</option>
              <option value="365">1y</option>
              <option value="all">All</option>
            </select>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono font-semibold rounded border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-300 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Sync...' : 'Sync'}
            </button>
          </div>
        </div>
      </div>

      {/* PHI National Ticker */}
      <PHITicker phi={nationalData?.phi} loading={nationalLoading} />

      {/* Metric Toggle Pills */}
      <div className="bg-slate-900/80 border-b border-slate-800 px-4">
        <HeatmapControls selected={selectedMetric} onSelect={setSelectedMetric} />
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar: PHI Metrics Legend */}
        <div className="hidden xl:flex flex-col w-[180px] flex-shrink-0 border-r border-slate-800 overflow-y-auto">
          <div className="px-3 py-3">
            <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">PHI Metrics</h3>
            <div className="space-y-2.5">
              {[
                { key: 'MHI', name: 'Market Heat Index', desc: 'Overall market temperature combining buyer demand, seller activity & engagement' },
                { key: 'BDI', name: 'Buyer Demand Index', desc: 'Real buyer interest from opinions, serious registrations & likes' },
                { key: 'SMI', name: 'Seller Motivation Index', desc: 'How eager sellers are to transact based on timelines & listing status' },
                { key: 'PVI', name: 'Price Validity Index', desc: 'How realistic asking prices are vs. market opinions' },
                { key: 'EVS', name: 'Engagement Velocity', desc: 'Speed & depth of buyer engagement on listings' },
                { key: 'BQI', name: 'Buyer Quality Index', desc: 'Seriousness & financial readiness of active buyers' },
                { key: 'FPI', name: 'Forward Pipeline Index', desc: 'Upcoming supply based on go-to-market timelines' },
                { key: 'SDB', name: 'Supply-Demand Balance', desc: 'Ratio of available properties vs. active buyer demand' },
              ].map((m) => (
                <div key={m.key} className="group">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-mono font-bold text-orange-400">{m.key}</span>
                    <span className="text-[10px] text-slate-400 truncate">{m.name}</span>
                  </div>
                  <p className="text-[10px] text-slate-600 leading-snug mt-0.5">{m.desc}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-auto px-3 py-3 border-t border-slate-800">
            <p className="text-[9px] text-slate-600 leading-snug">All scores are 0–100. Higher = stronger signal.</p>
          </div>
        </div>

        {/* Center: Map + Search + Report + Tables */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Map Section */}
          <div className="h-[40vh] lg:h-[50vh] flex-shrink-0 p-3 pb-0">
            <PHIHeatmap
              geojson={heatmapData}
              metric={selectedMetric}
              onSuburbClick={handleSuburbClick}
              loading={heatmapLoading}
              flyToLocation={flyToLocation}
              selectedMarker={selectedMarker}
            />
          </div>

          {/* Below Map Content */}
          <div className="flex-1 overflow-y-auto px-3 pb-3 pt-3 space-y-3">
            {/* Autocomplete Search */}
            <LocationSearch
              onLocationSelect={handleLocationSelect}
              searchRadius={searchRadius}
              onRadiusChange={setSearchRadius}
            />

            {/* Location Report */}
            {activeLocation && (
              <LocationReport
                location={activeLocation}
                reportData={reportData}
                reportLoading={reportLoading}
                onClose={handleCloseReport}
              />
            )}

            {/* Trending Areas */}
            <TrendingAreasTable areas={trendingAreas} loading={trendingLoading} />

            {/* Upcoming to Market */}
            <UpcomingToMarket data={upcomingData} loading={upcomingLoading} />
          </div>
        </div>

        {/* Right sidebar: Chat (100%) */}
        <div className="hidden lg:flex w-[300px] flex-col border-l border-slate-800 flex-shrink-0 min-h-0">
          <ChatPanel
            messages={messages}
            input={chatInput}
            setInput={setChatInput}
            onSend={sendMessage}
            sending={sending}
            onClear={clearChat}
            inputRef={inputRef}
            messagesEndRef={messagesEndRef}
            className="flex-1"
          />
        </div>
      </div>

      {/* Mobile Floating Chat Button */}
      <div className="lg:hidden fixed bottom-4 right-4 z-40">
        <AnimatePresence>
          {!chatOpen && (
            <motion.button
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              onClick={() => setChatOpen(true)}
              className="w-12 h-12 rounded-full bg-orange-600 text-white flex items-center justify-center shadow-lg shadow-orange-900/40"
            >
              <MessageSquare className="w-5 h-5" />
              {messages.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-slate-900 text-white text-[9px] font-bold rounded-full flex items-center justify-center border border-slate-700">
                  {messages.filter((m) => m.role === 'assistant').length}
                </span>
              )}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Mobile Chat Overlay */}
      <AnimatePresence>
        {chatOpen && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="lg:hidden fixed inset-0 z-50 bg-slate-950 flex flex-col"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 bg-gradient-to-br from-orange-500 to-orange-700 rounded flex items-center justify-center">
                  <Sparkles className="w-2.5 h-2.5 text-white" />
                </div>
                <span className="text-xs font-semibold text-slate-300">AI Assistant</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="p-1.5 hover:bg-slate-800 rounded transition-colors">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <ChatPanel
              messages={messages}
              input={chatInput}
              setInput={setChatInput}
              onSend={sendMessage}
              sending={sending}
              onClear={clearChat}
              inputRef={mobileInputRef}
              messagesEndRef={messagesEndRef}
              className="flex-1"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
