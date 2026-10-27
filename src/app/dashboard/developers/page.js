'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import { useRequireAgent } from '../../hooks/useRequireAgent';
import { authFetch } from '../../utils/authFetch';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/clientApp';
import {
  ArrowLeft,
  Key,
  Copy,
  Check,
  RefreshCw,
  Eye,
  EyeOff,
  Clock,
  ShieldCheck,
  ShieldX,
  Code,
  BookOpen,
  Zap,
  MessageSquare,
  Terminal,
} from 'lucide-react';
import { loginUrlForCurrentPage } from '../../utils/loginRedirect';

const API_BASE = typeof window !== 'undefined' ? window.location.origin : '';

const ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/v1/buyer-score',
    description: 'Buyer intent score (0-100) for a location',
    params: 'location, suburb, state, postcode, lat, lng, radius',
  },
  {
    method: 'GET',
    path: '/api/v1/seller-score',
    description: 'Seller intent score (0-100) for a location',
    params: 'location, suburb, state, postcode, lat, lng, radius',
  },
  {
    method: 'GET',
    path: '/api/v1/market-forecast',
    description: 'Properties going to market, expected prices, demand indicator',
    params: 'location, suburb, state, postcode, lat, lng, radius',
  },
  {
    method: 'GET',
    path: '/api/v1/trending-areas',
    description: 'Top trending areas ranked by buyer activity growth',
    params: 'limit, country',
  },
  {
    method: 'GET',
    path: '/api/v1/historical-trends',
    description: 'Buyer/seller score trends over past months',
    params: 'location, suburb, state, postcode, lat, lng, radius, months',
  },
  {
    method: 'GET',
    path: '/api/v1/property-insights',
    description: 'Per-property views, opinions, likes, price vs opinion gap',
    params: 'location, suburb, state, postcode, lat, lng, radius',
  },
];

export default function DevelopersPage() {
  useRequireAgent();
  const { user, userData, loading } = useAuth();
  const router = useRouter();
  const [apiAccess, setApiAccess] = useState(null);
  const [requesting, setRequesting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState('docs');

  useEffect(() => {
    if (!loading && !user) {
      router.replace(loginUrlForCurrentPage());
    }
  }, [user, loading, router]);

  // Listen for realtime updates to apiAccess
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (snap.exists()) {
        setApiAccess(snap.data().apiAccess || { status: 'none' });
      }
    });
    return () => unsub();
  }, [user]);

  const requestAccess = async () => {
    setRequesting(true);
    try {
      const res = await authFetch('/api/request-api-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to request access');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to request access');
    } finally {
      setRequesting(false);
    }
  };

  const regenerateKey = async () => {
    if (!confirm('Are you sure? Your current API key will stop working immediately.')) return;
    setRegenerating(true);
    try {
      const res = await authFetch('/api/admin/api-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUid: user.uid, action: 'regenerate' }),
      });
      if (!res.ok) {
        alert('Failed to regenerate key');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRegenerating(false);
    }
  };

  const copyKey = () => {
    if (apiAccess?.apiKey) {
      navigator.clipboard.writeText(apiAccess.apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const maskKey = (key) => {
    if (!key) return '';
    return key.substring(0, 6) + '*'.repeat(key.length - 10) + key.substring(key.length - 4);
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    );
  }

  const status = apiAccess?.status || 'none';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-4">
          <Link href="/dashboard" className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-[#e48900] to-[#c64500] rounded-lg flex items-center justify-center">
              <Code className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">Developer Portal</h1>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Status Card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl border border-slate-200 p-6"
        >
          {status === 'none' && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Key className="w-8 h-8 text-slate-400" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">API Access</h2>
              <p className="text-slate-500 mb-6 max-w-md mx-auto">
                Get programmatic access to Premarket&apos;s market intelligence data. Request an API key to get started.
              </p>
              <button
                onClick={requestAccess}
                disabled={requesting}
                className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-semibold rounded-xl shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 transition-all disabled:opacity-50"
              >
                {requesting ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                ) : (
                  <Key className="w-4 h-4" />
                )}
                Request API Access
              </button>
            </div>
          )}

          {status === 'pending' && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Clock className="w-8 h-8 text-amber-500" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">Request Pending</h2>
              <p className="text-slate-500 max-w-md mx-auto">
                Your API access request is being reviewed. You&apos;ll be notified once it&apos;s approved.
              </p>
            </div>
          )}

          {status === 'revoked' && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <ShieldX className="w-8 h-8 text-red-500" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">Access Revoked</h2>
              <p className="text-slate-500 max-w-md mx-auto">
                Your API access has been revoked. Contact support if you believe this is an error.
              </p>
            </div>
          )}

          {status === 'approved' && (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">API Access Active</h2>
                  <p className="text-sm text-slate-500">Your API key is ready to use</p>
                </div>
              </div>

              {/* API Key Display */}
              <div className="bg-slate-50 rounded-xl p-4 mb-4">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">
                  Your API Key
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white border border-slate-200 rounded-lg px-4 py-3 text-sm font-mono text-slate-900 select-all">
                    {showKey ? apiAccess.apiKey : maskKey(apiAccess.apiKey)}
                  </code>
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="p-3 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                    title={showKey ? 'Hide' : 'Reveal'}
                  >
                    {showKey ? <EyeOff className="w-4 h-4 text-slate-500" /> : <Eye className="w-4 h-4 text-slate-500" />}
                  </button>
                  <button
                    onClick={copyKey}
                    className="p-3 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                    title="Copy"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-slate-500" />}
                  </button>
                  <button
                    onClick={regenerateKey}
                    disabled={regenerating}
                    className="p-3 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                    title="Regenerate"
                  >
                    <RefreshCw className={`w-4 h-4 text-slate-500 ${regenerating ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  Include this key as <code className="bg-slate-200 px-1 rounded">x-api-key</code> header in all API requests.
                </p>
              </div>
            </div>
          )}
        </motion.div>

        {/* Documentation — only show when approved */}
        {status === 'approved' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            {/* Tab Switcher */}
            <div className="flex gap-1 mb-4 bg-slate-100 rounded-xl p-1 w-fit">
              {[
                { id: 'docs', label: 'Endpoints', icon: BookOpen },
                { id: 'examples', label: 'Examples', icon: Code },
                ...(userData?.superAdmin === true
                  ? [{ id: 'mcp', label: 'MCP Server', icon: Terminal }]
                  : []),
              ].map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      activeTab === tab.id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {activeTab === 'docs' && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200">
                  <h3 className="text-sm font-semibold text-slate-900">API Endpoints</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    All endpoints accept a freeform <code className="bg-slate-100 px-1 rounded">location</code> string (e.g. &quot;Bondi Beach, NSW&quot;) which is geocoded automatically.
                    You can also use <code className="bg-slate-100 px-1 rounded">suburb</code> + <code className="bg-slate-100 px-1 rounded">state</code>,{' '}
                    <code className="bg-slate-100 px-1 rounded">postcode</code>, or <code className="bg-slate-100 px-1 rounded">lat</code> + <code className="bg-slate-100 px-1 rounded">lng</code> + <code className="bg-slate-100 px-1 rounded">radius</code> (km, default 5).
                  </p>
                </div>
                <div className="divide-y divide-slate-100">
                  {ENDPOINTS.map((ep) => (
                    <div key={ep.path} className="px-6 py-4 hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="px-2 py-0.5 text-xs font-bold rounded bg-emerald-100 text-emerald-700">
                          {ep.method}
                        </span>
                        <code className="text-sm font-mono text-slate-900">{ep.path}</code>
                      </div>
                      <p className="text-sm text-slate-500">{ep.description}</p>
                      <p className="text-xs text-slate-400 mt-1">Params: {ep.params}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'examples' && (
              <div className="space-y-4">
                {/* cURL */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-6 py-3 border-b border-slate-200 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-semibold text-slate-900">cURL</span>
                  </div>
                  <pre className="px-6 py-4 text-sm text-slate-700 overflow-x-auto bg-slate-50">
{`curl -H "x-api-key: ${showKey ? apiAccess?.apiKey || 'YOUR_API_KEY' : 'YOUR_API_KEY'}" \\
  "${API_BASE}/api/v1/buyer-score?location=Bondi+Beach,+NSW"`}
                  </pre>
                </div>

                {/* JavaScript */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-6 py-3 border-b border-slate-200 flex items-center gap-2">
                    <Code className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-semibold text-slate-900">JavaScript</span>
                  </div>
                  <pre className="px-6 py-4 text-sm text-slate-700 overflow-x-auto bg-slate-50">
{`const response = await fetch(
  '${API_BASE}/api/v1/buyer-score?location=Bondi+Beach,+NSW',
  {
    headers: { 'x-api-key': 'YOUR_API_KEY' }
  }
);
const data = await response.json();
console.log(data.score); // 0-100
console.log(data.location.resolvedPlace); // "Bondi Beach, NSW, Australia"`}
                  </pre>
                </div>

                {/* Python */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-6 py-3 border-b border-slate-200 flex items-center gap-2">
                    <Code className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-semibold text-slate-900">Python</span>
                  </div>
                  <pre className="px-6 py-4 text-sm text-slate-700 overflow-x-auto bg-slate-50">
{`import requests

response = requests.get(
    '${API_BASE}/api/v1/buyer-score',
    params={'location': 'Bondi Beach, NSW'},
    headers={'x-api-key': 'YOUR_API_KEY'}
)
data = response.json()
print(f"Buyer Score: {data['score']}")`}
                  </pre>
                </div>
              </div>
            )}

            {activeTab === 'mcp' && userData?.superAdmin === true && (
              <div className="space-y-4">
                {/* What is MCP */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-200">
                    <h3 className="text-sm font-semibold text-slate-900">MCP Server</h3>
                    <p className="text-xs text-slate-500 mt-1">
                      The Premarket MCP (Model Context Protocol) server lets AI assistants like Claude query our market intelligence API conversationally.
                      Ask questions like &quot;What is the buyer score for Bondi?&quot; and get real data back.
                    </p>
                  </div>

                  <div className="px-6 py-4 space-y-4">
                    {/* Install */}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">1. Install</h4>
                      <pre className="bg-slate-50 rounded-lg px-4 py-3 text-sm text-slate-700 overflow-x-auto">
{`git clone https://github.com/premarket-homes/premarket-website.git
cd premarket-website/mcp-server
npm install`}
                      </pre>
                    </div>

                    {/* Configure */}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">2. Configure Claude Desktop</h4>
                      <p className="text-xs text-slate-500 mb-2">
                        Add the following to your Claude Desktop config at{' '}
                        <code className="bg-slate-100 px-1 rounded">~/Library/Application Support/Claude/claude_desktop_config.json</code>
                      </p>
                      <pre className="bg-slate-50 rounded-lg px-4 py-3 text-sm text-slate-700 overflow-x-auto">
{`{
  "mcpServers": {
    "premarket": {
      "command": "node",
      "args": ["/path/to/mcp-server/index.js"],
      "env": {
        "PREMARKET_API_KEY": "${showKey ? apiAccess?.apiKey || 'YOUR_API_KEY' : 'YOUR_API_KEY'}",
        "PREMARKET_API_URL": "${API_BASE || 'https://premarket.homes'}"
      }
    }
  }
}`}
                      </pre>
                    </div>

                    {/* Run standalone */}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">3. Or run standalone</h4>
                      <pre className="bg-slate-50 rounded-lg px-4 py-3 text-sm text-slate-700 overflow-x-auto">
{`PREMARKET_API_KEY=${showKey ? apiAccess?.apiKey || 'YOUR_API_KEY' : 'YOUR_API_KEY'} \\
  node mcp-server/index.js`}
                      </pre>
                    </div>
                  </div>
                </div>

                {/* Available Tools */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-200">
                    <h3 className="text-sm font-semibold text-slate-900">Available Tools</h3>
                    <p className="text-xs text-slate-500 mt-1">
                      These tools are automatically available to the AI when the MCP server is connected. Each accepts a freeform <code className="bg-slate-100 px-1 rounded">location</code> string.
                    </p>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {[
                      { name: 'get_buyer_score', description: 'Buyer intent score (0-100) for a location', example: 'What is the buyer score for Bondi, NSW?' },
                      { name: 'get_seller_score', description: 'Seller intent score (0-100) for a location', example: 'How much selling intent is there in Surry Hills?' },
                      { name: 'get_market_forecast', description: 'Properties going to market, expected prices, demand', example: 'How many homes are going to market next month in Sydney CBD?' },
                      { name: 'get_trending_areas', description: 'Top trending areas by buyer activity growth', example: 'What are the trending suburbs in Australia right now?' },
                      { name: 'get_historical_trends', description: 'Buyer/seller score trends over past months', example: 'How have buyer trends changed in Manly over 6 months?' },
                      { name: 'get_property_insights', description: 'Per-property views, opinions, likes, price gap', example: 'Show me property insights for Melbourne CBD' },
                    ].map((tool) => (
                      <div key={tool.name} className="px-6 py-4 hover:bg-slate-50 transition-colors">
                        <div className="flex items-center gap-3 mb-1">
                          <span className="px-2 py-0.5 text-xs font-bold rounded bg-violet-100 text-violet-700">
                            TOOL
                          </span>
                          <code className="text-sm font-mono text-slate-900">{tool.name}</code>
                        </div>
                        <p className="text-sm text-slate-500">{tool.description}</p>
                        <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                          <MessageSquare className="w-3 h-3" />
                          &quot;{tool.example}&quot;
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Environment Variables */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-200">
                    <h3 className="text-sm font-semibold text-slate-900">Environment Variables</h3>
                  </div>
                  <div className="divide-y divide-slate-100">
                    <div className="px-6 py-3 flex items-start gap-4">
                      <code className="text-sm font-mono text-slate-900 flex-shrink-0 mt-0.5">PREMARKET_API_KEY</code>
                      <p className="text-sm text-slate-500">Required. Your Premarket API key.</p>
                    </div>
                    <div className="px-6 py-3 flex items-start gap-4">
                      <code className="text-sm font-mono text-slate-900 flex-shrink-0 mt-0.5">PREMARKET_API_URL</code>
                      <p className="text-sm text-slate-500">Optional. API base URL. Defaults to <code className="bg-slate-100 px-1 rounded text-xs">https://premarket.homes</code></p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
