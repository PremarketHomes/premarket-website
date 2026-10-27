'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../context/AuthContext';
import 'rrweb-player/dist/style.css';
import {
  ArrowLeft,
  Shield,
  LinkIcon,
  Copy,
  Check,
  X,
  Play,
  Clock,
  Eye,
  Monitor,
  ExternalLink,
  ChevronRight,
  MousePointer,
  Type,
  Globe,
  RefreshCw,
} from 'lucide-react';
import { loginUrlForCurrentPage } from '../../../utils/loginRedirect';

function formatDate(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(seconds) {
  if (!seconds) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function parseUserAgent(ua) {
  if (!ua) return null;
  let browser = 'Unknown';
  let os = 'Unknown';
  if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Edg')) browser = 'Edge';
  if (ua.includes('Mac OS X')) os = 'macOS';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('Linux')) os = 'Linux';
  return { browser, os };
}

export default function DocsAnalyticsPage() {
  const { user, userData, loading } = useAuth();
  const router = useRouter();

  const [links, setLinks] = useState([]);
  const [linksLoading, setLinksLoading] = useState(true);
  const [selectedLink, setSelectedLink] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);
  const [copiedToken, setCopiedToken] = useState(null);
  const [deactivating, setDeactivating] = useState(null);
  const [resetting, setResetting] = useState(null);

  // Auth guard
  useEffect(() => {
    if (!loading && !user) {
      router.replace(loginUrlForCurrentPage());
      return;
    }
    if (!loading && userData && userData.superAdmin !== true) {
      router.push('/dashboard');
    }
  }, [user, userData, loading, router]);

  // Fetch links
  const fetchLinks = useCallback(async () => {
    if (!user) return;
    setLinksLoading(true);
    try {
      const res = await fetch(`/api/docs/links?uid=${user.uid}`);
      const data = await res.json();
      setLinks(data.links || []);
    } catch (err) {
      console.error('Failed to fetch links:', err);
    } finally {
      setLinksLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user && userData?.superAdmin === true) {
      fetchLinks();
    }
  }, [user, userData, fetchLinks]);

  // Fetch sessions for a link
  const fetchSessions = async (linkToken) => {
    setSessionsLoading(true);
    setSessions([]);
    try {
      const { collection, query, where, getDocs } = await import('firebase/firestore');
      const { db } = await import('../../../firebase/clientApp');

      const q = query(
        collection(db, 'docSessions'),
        where('linkToken', '==', linkToken)
      );
      const snapshot = await getDocs(q);
      const sessionList = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
      setSessions(sessionList);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    } finally {
      setSessionsLoading(false);
    }
  };

  const handleSelectLink = (link) => {
    setSelectedLink(link);
    setSelectedSession(null);
    fetchSessions(link.token);
  };

  const handleCopy = (token) => {
    navigator.clipboard.writeText(`https://premarket.homes/docs?t=${token}`);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleReset = async (token) => {
    setResetting(token);
    try {
      await fetch(`/api/docs/links/${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid }),
      });
      await fetchLinks();
      if (selectedLink?.token === token) {
        setSelectedLink((prev) => prev ? { ...prev, expired: false } : prev);
      }
    } catch (err) {
      console.error('Failed to reset:', err);
    } finally {
      setResetting(null);
    }
  };

  const handleDeactivate = async (token) => {
    if (!confirm('Deactivate this link? Visitors will no longer be able to access docs with it.')) return;
    setDeactivating(token);
    try {
      await fetch(`/api/docs/links/${token}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid }),
      });
      await fetchLinks();
      if (selectedLink?.token === token) {
        setSelectedLink(null);
        setSessions([]);
      }
    } catch (err) {
      console.error('Failed to deactivate:', err);
    } finally {
      setDeactivating(null);
    }
  };

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
              <Shield className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">Docs Analytics</h1>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Session detail view */}
        {selectedSession && (
          <SessionDetailView
            session={selectedSession}
            onClose={() => setSelectedSession(null)}
          />
        )}

        {/* Sessions list view */}
        {!selectedSession && selectedLink && (
          <div>
            <button
              onClick={() => { setSelectedLink(null); setSessions([]); }}
              className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition-colors mb-6"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to all links
            </button>

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
              <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      {selectedLink.label || 'Unlabelled Link'}
                    </h2>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">{selectedLink.token}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedLink.expired && selectedLink.active && (
                      <button
                        onClick={() => handleReset(selectedLink.token)}
                        disabled={resetting === selectedLink.token}
                        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors disabled:opacity-50"
                      >
                        {resetting === selectedLink.token ? (
                          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-amber-600" />
                        ) : (
                          <RefreshCw className="w-3 h-3" />
                        )}
                        Reset
                      </button>
                    )}
                    <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
                      !selectedLink.active
                        ? 'bg-red-100 text-red-700'
                        : selectedLink.expired
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {!selectedLink.active ? 'Deactivated' : selectedLink.expired ? 'Expired' : 'Active'}
                    </span>
                  </div>
                </div>
              </div>

              {sessionsLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-4 border-orange-500" />
                </div>
              ) : sessions.length === 0 ? (
                <div className="text-center py-16">
                  <Eye className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500 text-sm">No sessions recorded yet</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {sessions.map((session) => {
                    const device = parseUserAgent(session.userAgent);
                    return (
                      <button
                        key={session.sessionId}
                        onClick={() => setSelectedSession(session)}
                        className="w-full text-left px-6 py-4 flex items-center gap-4 hover:bg-slate-50 transition-colors group"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <span className="text-sm text-slate-900">
                              {formatDate(session.startedAt)}
                            </span>
                            <span className="text-xs text-slate-400">
                              {formatDuration(session.duration)}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-500">
                            <span>{session.sectionsViewed?.length || 0} sections viewed</span>
                            <span>{session.interactions?.length || 0} interactions</span>
                            {device && (
                              <span className="text-slate-400">{device.browser} / {device.os}</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          {session.recordingUrl && (
                            <span className="px-2 py-0.5 text-xs font-medium rounded bg-emerald-100 text-emerald-700">
                              Recording
                            </span>
                          )}
                          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Links list (default view) */}
        {!selectedSession && !selectedLink && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-600">
                Trackable Links ({links.length})
              </h2>
              <Link
                href="/docs"
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View Docs
              </Link>
            </div>

            {linksLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
              </div>
            ) : links.length === 0 ? (
              <div className="text-center py-16">
                <LinkIcon className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">No trackable links created yet</p>
                <p className="text-slate-400 text-xs mt-1">
                  Generate links from the docs page floating toolbar
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {links.map((link) => (
                  <div
                    key={link.token}
                    className="px-6 py-4 flex items-center gap-4 hover:bg-slate-50 transition-colors"
                  >
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => handleSelectLink(link)}
                    >
                      <div className="flex items-center gap-3 mb-0.5">
                        <p className="font-semibold text-slate-900 text-sm">
                          {link.label || 'Unlabelled'}
                        </p>
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                          !link.active
                            ? 'bg-red-100 text-red-700'
                            : link.expired
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {!link.active ? 'Deactivated' : link.expired ? 'Expired' : 'Active'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 font-mono">{link.token}</p>
                      <div className="flex items-center gap-4 mt-1 text-xs text-slate-500">
                        <span>{formatDate(link.createdAt)}</span>
                        <span>{link.sessionCount || 0} sessions</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleCopy(link.token)}
                        className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
                        title="Copy URL"
                      >
                        {copiedToken === link.token ? (
                          <Check className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Copy className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                      {link.expired && link.active && (
                        <button
                          onClick={() => handleReset(link.token)}
                          disabled={resetting === link.token}
                          className="p-2 rounded-lg text-amber-500 hover:bg-amber-50 hover:text-amber-700 transition-colors disabled:opacity-50"
                          title="Reset expiry"
                        >
                          {resetting === link.token ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-amber-500" />
                          ) : (
                            <RefreshCw className="w-4 h-4" />
                          )}
                        </button>
                      )}
                      {link.active && (
                        <button
                          onClick={() => handleDeactivate(link.token)}
                          disabled={deactivating === link.token}
                          className="p-2 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-50"
                          title="Deactivate"
                        >
                          {deactivating === link.token ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-500" />
                          ) : (
                            <X className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Session Detail View ─── */
function SessionDetailView({ session, onClose }) {
  const playerContainerRef = useRef(null);
  const [loadingReplay, setLoadingReplay] = useState(!!session.recordingUrl);
  const [replayError, setReplayError] = useState(null);
  const device = parseUserAgent(session.userAgent);

  useEffect(() => {
    if (!session.recordingUrl || !playerContainerRef.current) return;

    let mounted = true;

    async function loadReplay() {
      try {
        // Proxy through our API to avoid CORS issues with Bunny CDN
        const res = await fetch(`/api/docs/sessions/recording?id=${session.sessionId}`);
        if (!res.ok) throw new Error('Failed to fetch recording');
        const events = await res.json();

        if (!mounted || !playerContainerRef.current || !events.length) return;

        playerContainerRef.current.innerHTML = '';

        const rrwebPlayer = await import('rrweb-player');
        const Player = rrwebPlayer.default || rrwebPlayer;

        new Player({
          target: playerContainerRef.current,
          props: {
            events,
            width: playerContainerRef.current.offsetWidth,
            height: 500,
            autoPlay: false,
          },
        });

        if (mounted) setLoadingReplay(false);
      } catch (err) {
        console.error('Replay error:', err);
        if (mounted) {
          setReplayError('Failed to load session replay');
          setLoadingReplay(false);
        }
      }
    }

    loadReplay();
    return () => { mounted = false; };
  }, [session.recordingUrl]);

  return (
    <div>
      <button
        onClick={onClose}
        className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition-colors mb-6"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to sessions
      </button>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 mb-1">Duration</p>
          <p className="text-xl font-bold text-slate-900">{formatDuration(session.duration)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 mb-1">Sections Viewed</p>
          <p className="text-xl font-bold text-slate-900">{session.sectionsViewed?.length || 0}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 mb-1">Interactions</p>
          <p className="text-xl font-bold text-slate-900">{session.interactions?.length || 0}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 mb-1">Device</p>
          <p className="text-xl font-bold text-slate-900">{device?.browser || '--'}</p>
          <p className="text-xs text-slate-400">{device?.os || ''}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: replay or session info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Session replay player */}
          {session.recordingUrl && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                <Play className="w-4 h-4 text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-900">Session Replay</h3>
              </div>
              <div className="p-4">
                {loadingReplay && !replayError && (
                  <div className="flex items-center justify-center py-20">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-4 border-orange-500" />
                  </div>
                )}
                {replayError && (
                  <div className="text-center py-12">
                    <p className="text-red-500 text-sm">{replayError}</p>
                  </div>
                )}
                <div ref={playerContainerRef} />
              </div>
            </div>
          )}

          {/* Sections viewed */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <Eye className="w-4 h-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-900">
                Sections Viewed ({session.sectionsViewed?.length || 0})
              </h3>
            </div>
            {session.sectionsViewed?.length > 0 ? (
              <div className="p-4">
                <div className="flex flex-wrap gap-2">
                  {session.sectionsViewed.map((s, i) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-100 text-slate-700 rounded-lg"
                    >
                      <span className="w-5 h-5 bg-slate-200 rounded-full text-xs flex items-center justify-center font-medium text-slate-600">
                        {i + 1}
                      </span>
                      {s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-slate-400 text-sm">No sections tracked</p>
              </div>
            )}
          </div>

          {/* Interactions timeline */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <MousePointer className="w-4 h-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-900">
                Interactions ({session.interactions?.length || 0})
              </h3>
            </div>
            {session.interactions?.length > 0 ? (
              <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
                {session.interactions.map((interaction, i) => {
                  const relativeTime = session.startedAt
                    ? Math.round((interaction.timestamp - new Date(session.startedAt).getTime()) / 1000)
                    : null;
                  return (
                    <div key={i} className="px-6 py-3 flex items-start gap-3">
                      <div className="flex-shrink-0 mt-0.5">
                        {interaction.type === 'click' ? (
                          <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center">
                            <MousePointer className="w-3 h-3 text-blue-600" />
                          </div>
                        ) : (
                          <div className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center">
                            <Type className="w-3 h-3 text-purple-600" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-xs font-medium ${
                            interaction.type === 'click'
                              ? 'text-blue-700'
                              : 'text-purple-700'
                          }`}>
                            {interaction.type === 'click' ? 'Click' : 'Selection'}
                          </span>
                          {relativeTime !== null && (
                            <span className="text-xs text-slate-400">
                              +{formatDuration(Math.max(0, relativeTime))}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-600 break-words">
                          {interaction.target || '--'}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-slate-400 text-sm">No interactions recorded</p>
              </div>
            )}
          </div>
        </div>

        {/* Right column: metadata */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Session Info</h4>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-slate-500">Started</p>
                <p className="text-sm text-slate-900">{formatDate(session.startedAt)}</p>
              </div>
              {session.endedAt && (
                <div>
                  <p className="text-xs text-slate-500">Ended</p>
                  <p className="text-sm text-slate-900">{formatDate(session.endedAt)}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-slate-500">Session ID</p>
                <p className="text-xs text-slate-600 font-mono break-all">{session.sessionId}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Link Token</p>
                <p className="text-xs text-slate-600 font-mono break-all">{session.linkToken}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Recording</p>
                <p className="text-sm text-slate-900">
                  {session.recordingUrl ? (
                    <span className="text-emerald-600 font-medium">Available</span>
                  ) : (
                    <span className="text-slate-400">Not captured</span>
                  )}
                </p>
              </div>
            </div>
          </div>

          {session.userAgent && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                <span className="flex items-center gap-1.5">
                  <Monitor className="w-3.5 h-3.5" />
                  Device
                </span>
              </h4>
              {device && (
                <div className="space-y-2 mb-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Browser</span>
                    <span className="text-slate-900 font-medium">{device.browser}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">OS</span>
                    <span className="text-slate-900 font-medium">{device.os}</span>
                  </div>
                </div>
              )}
              <p className="text-xs text-slate-400 break-all leading-relaxed">{session.userAgent}</p>
            </div>
          )}

          {session.referrer && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                <span className="flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" />
                  Referrer
                </span>
              </h4>
              <p className="text-sm text-slate-600 break-all">{session.referrer}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
