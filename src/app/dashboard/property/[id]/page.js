'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '../../../context/AuthContext';
import { useRequireAgent } from '../../../hooks/useRequireAgent';
import { authFetch } from '../../../utils/authFetch';
import { db } from '../../../firebase/clientApp';
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  orderBy,
  serverTimestamp,
  deleteField,
} from 'firebase/firestore';
import {
  ArrowLeft,
  Eye,
  Heart,
  MessageSquare,
  Users,
  TrendingUp,
  Home,
  Bed,
  Bath,
  Car,
  ChevronLeft,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
  Trash2,
  BarChart3,
  PieChart,
  Clock,
  DollarSign,
  UserCheck,
  UserX,
  Link2,
  Check,
  ExternalLink,
  Pencil,
  Archive,
  Send,
  FileText,
  Mail,
  X,
  MoreVertical,
  Tablet,
  Copy,
  Wand2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  Sparkles,
  Download,
} from 'lucide-react';
import { formatPrice, formatDate } from '../../../utils/formatters';

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// --- Engagement Stat Card ---
function EngagementCard({ label, value, icon: Icon }) {
  return (
    <div className="rounded-xl p-5 bg-white border border-slate-200">
      <div className="flex items-center justify-between mb-2">
        <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center">
          <Icon className="w-4.5 h-4.5 text-slate-500" />
        </div>
      </div>
      <div className="text-3xl font-bold text-slate-900">{value}</div>
      <div className="text-xs font-medium text-slate-500 mt-1">{label}</div>
    </div>
  );
}

// --- Median Price Card ---
function MedianCard({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium text-slate-500 mb-1">{label}</div>
      <div className="text-lg font-bold text-slate-900">{value ? formatPrice(value) : '--'}</div>
    </div>
  );
}

// --- Media Gallery (Video + Images) ---
function MediaGallery({ images, videoUrl, onEditImage }) {
  const [current, setCurrent] = useState(0);
  const hasVideo = !!videoUrl;
  const imageList = images || [];
  // Video is slide 0 if it exists, images follow
  const totalSlides = imageList.length + (hasVideo ? 1 : 0);
  const isVideoSlide = hasVideo && current === 0;
  const imageIndex = hasVideo ? current - 1 : current;

  return (
    <div className="relative w-full rounded-xl overflow-hidden bg-slate-100">
      {/* Video slide */}
      {isVideoSlide && (
        <div className="relative bg-black">
          <video
            src={videoUrl}
            controls
            playsInline
            preload="metadata"
            poster={imageList[0]}
            className="w-full rounded-xl"
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.parentElement.innerHTML = '<div class="flex items-center justify-center py-12 text-white/60 text-sm">Video unavailable</div>';
            }}
          />
        </div>
      )}

      {/* Image slides */}
      {!isVideoSlide && imageList.length > 0 && (
        <div className="relative w-full h-64 sm:h-80">
          <Image
            src={imageList[imageIndex]}
            alt={`Property image ${imageIndex + 1}`}
            fill
            className="object-cover"
            unoptimized
          />
        </div>
      )}

      {/* Empty state */}
      {totalSlides === 0 && (
        <div className="w-full h-64 sm:h-80 flex items-center justify-center">
          <Home className="w-16 h-16 text-slate-300" />
        </div>
      )}

      {/* AI Edit button — only on image slides */}
      {!isVideoSlide && imageList.length > 0 && onEditImage && (
        <button
          onClick={() => onEditImage(imageList[imageIndex], imageIndex)}
          className="absolute top-3 left-3 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold shadow-lg transition-colors flex items-center gap-1.5 z-10"
        >
          <Wand2 className="w-3.5 h-3.5" />
          AI Edit
        </button>
      )}

      {/* Navigation arrows */}
      {totalSlides > 1 && (
        <>
          <button
            onClick={() => setCurrent((c) => (c - 1 + totalSlides) % totalSlides)}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/40 hover:bg-black/60 rounded-full flex items-center justify-center text-white transition-colors z-10"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => setCurrent((c) => (c + 1) % totalSlides)}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/40 hover:bg-black/60 rounded-full flex items-center justify-center text-white transition-colors z-10"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10">
            {Array.from({ length: totalSlides }).map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`w-2 h-2 rounded-full transition-all ${
                  i === current ? 'bg-white w-4' : 'bg-white/50'
                }`}
              />
            ))}
          </div>
        </>
      )}

      {/* Slide counter + label */}
      {totalSlides > 0 && (
        <div className="absolute top-3 right-3 px-2.5 py-1 bg-black/50 rounded-lg text-white text-xs font-medium z-10">
          {isVideoSlide ? 'Video' : `${imageIndex + 1} / ${imageList.length}`}
        </div>
      )}
    </div>
  );
}

// --- Price Distribution Bar ---
function PriceDistribution({ opinions }) {
  const amounts = opinions
    .map(o => parseFloat(o.offerAmount) || 0)
    .filter(a => a > 0)
    .sort((a, b) => a - b);

  if (amounts.length < 2) return null;

  const min = amounts[0];
  const max = amounts[amounts.length - 1];
  const range = max - min;
  if (range === 0) return null;

  // Create 5 buckets
  const bucketSize = range / 5;
  const buckets = Array(5).fill(0);
  amounts.forEach(a => {
    const idx = Math.min(Math.floor((a - min) / bucketSize), 4);
    buckets[idx]++;
  });
  const maxCount = Math.max(...buckets);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-slate-500" />
        Price Distribution
      </h3>
      <div className="space-y-2">
        {buckets.map((count, i) => {
          const bucketMin = min + i * bucketSize;
          const bucketMax = min + (i + 1) * bucketSize;
          const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
          return (
            <div key={i} className="flex items-center gap-3">
              <span className="text-xs text-slate-500 w-32 text-right shrink-0">
                {formatPrice(bucketMin)} - {formatPrice(bucketMax)}
              </span>
              <div className="flex-1 h-6 bg-slate-100 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, delay: i * 0.1 }}
                  className="h-full bg-slate-800 rounded-full"
                />
              </div>
              <span className="text-xs font-semibold text-slate-700 w-6 text-right">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Buyer Breakdown ---
function BuyerBreakdown({ seriousBuyers, passiveBuyers, opinions }) {
  const total = opinions.length;
  if (total === 0) return null;

  const seriousPct = Math.round((seriousBuyers.length / total) * 100);
  const passivePct = 100 - seriousPct;
  const fhbCount = opinions.filter(o => o.isFirstHomeBuyer).length;
  const investorCount = opinions.filter(o => o.isInvestor).length;

  // Seriousness distribution
  const seriousnessLevels = {};
  opinions.forEach(o => {
    const level = o.seriousnessLevel || 'Unknown';
    seriousnessLevels[level] = (seriousnessLevels[level] || 0) + 1;
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
        <PieChart className="w-4 h-4 text-slate-500" />
        Buyer Breakdown
      </h3>

      {/* Serious vs Passive bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-slate-900 font-semibold">Serious ({seriousBuyers.length})</span>
          <span className="text-slate-500 font-semibold">Passive ({passiveBuyers.length})</span>
        </div>
        <div className="h-4 bg-slate-100 rounded-full overflow-hidden flex">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${seriousPct}%` }}
            transition={{ duration: 0.8 }}
            className="bg-slate-800 rounded-l-full"
          />
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${passivePct}%` }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="bg-slate-300 rounded-r-full"
          />
        </div>
      </div>

      {/* Buyer Type Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
          <div className="text-2xl font-bold text-slate-900">{fhbCount}</div>
          <div className="text-xs text-slate-500 font-medium mt-1">First Home Buyers</div>
        </div>
        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
          <div className="text-2xl font-bold text-slate-900">{investorCount}</div>
          <div className="text-xs text-slate-500 font-medium mt-1">Investors</div>
        </div>
      </div>

      {/* Seriousness Distribution */}
      {Object.keys(seriousnessLevels).length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <p className="text-xs font-semibold text-slate-600 mb-2">Seriousness Levels</p>
          <div className="flex items-center gap-2 flex-wrap">
            {Object.entries(seriousnessLevels)
              .sort(([a], [b]) => Number(b) - Number(a))
              .map(([level, count]) => (
                <span key={level} className="px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-medium text-slate-700">
                  Level {level}: {count}
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Price Timeline ---
function PriceTimeline({ opinions }) {
  const points = useMemo(() => {
    return opinions
      .filter(o => o.createdAt && (parseFloat(o.offerAmount) || 0) > 0)
      .map(o => {
        const d = o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
        return { date: d, price: parseFloat(o.offerAmount), serious: !!o.serious };
      })
      .filter(p => !isNaN(p.date.getTime()))
      .sort((a, b) => a.date - b.date);
  }, [opinions]);

  if (points.length < 2) return null;

  const W = 600, H = 220;
  const pad = { top: 20, right: 20, bottom: 40, left: 70 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  const prices = points.map(p => p.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;
  const minTime = points[0].date.getTime();
  const maxTime = points[points.length - 1].date.getTime();
  const timeRange = maxTime - minTime || 1;

  const toX = (t) => pad.left + ((t - minTime) / timeRange) * chartW;
  const toY = (p) => pad.top + chartH - ((p - minPrice) / priceRange) * chartH;

  // Y-axis labels (4 levels)
  const yLabels = [];
  for (let i = 0; i <= 3; i++) {
    const val = minPrice + (priceRange * i) / 3;
    yLabels.push({ val, y: toY(val) });
  }

  // Build line path
  const linePath = points.map((p, i) => {
    const x = toX(p.date.getTime());
    const y = toY(p.price);
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');

  // X-axis date labels (first, middle, last)
  const xLabels = [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]].map(p => ({
    x: toX(p.date.getTime()),
    label: p.date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }),
  }));

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-slate-500" />
        Price Opinion Timeline
      </h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {yLabels.map((l, i) => (
          <g key={i}>
            <line x1={pad.left} y1={l.y} x2={W - pad.right} y2={l.y} stroke="#F1F5F9" strokeWidth="1" />
            <text x={pad.left - 8} y={l.y + 4} textAnchor="end" fill="#94A3B8" fontSize="10">
              {formatPrice(l.val)}
            </text>
          </g>
        ))}

        {/* Axes */}
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + chartH} stroke="#CBD5E1" strokeWidth="1" />
        <line x1={pad.left} y1={pad.top + chartH} x2={W - pad.right} y2={pad.top + chartH} stroke="#CBD5E1" strokeWidth="1" />

        {/* Line */}
        <path d={linePath} fill="none" stroke="#94A3B8" strokeWidth="2" />

        {/* Dots */}
        {points.map((p, i) => {
          const x = toX(p.date.getTime());
          const y = toY(p.price);
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={p.serious ? 5 : 3.5}
              fill={p.serious ? '#1E293B' : '#F97316'}
              stroke="#fff"
              strokeWidth="1.5"
            />
          );
        })}

        {/* X-axis labels */}
        {xLabels.map((l, i) => (
          <text key={i} x={l.x} y={H - 8} textAnchor="middle" fill="#94A3B8" fontSize="10">
            {l.label}
          </text>
        ))}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-slate-900 inline-block" />
          Serious
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-orange-500 inline-block" />
          Passive
        </span>
      </div>
    </div>
  );
}

function fmtBuyerType(type) {
  if (!type) return '--';
  const map = { cash: 'Cash', approved_finance: 'Approved Finance', pre_approval: 'Pre-Approval', not_yet: 'Not Yet' };
  return map[type] || type;
}

function fmtInterestLevel(level) {
  if (!level) return '--';
  const map = { just_browsing: 'Just Browsing', interested: 'Interested', very_interested: 'Very Interested', ready_to_buy: 'Ready to Buy' };
  return map[level] || level;
}

function fmtBudget(val) {
  if (!val) return null;
  if (val >= 1000000) return `$${(val / 1000000).toFixed(val % 1000000 === 0 ? 0 : 1)}M`;
  if (val >= 1000) return `$${Math.round(val / 1000)}K`;
  return formatPrice(val);
}

// --- Opinions Table ---
function OpinionsTable({ opinions }) {
  const [showAnonymous, setShowAnonymous] = useState(false);
  const [anonSortField, setAnonSortField] = useState('offerAmount');
  const [anonSortDir, setAnonSortDir] = useState('desc');

  const seriousOpinions = useMemo(() => {
    return [...opinions]
      .filter(o => o.serious === true)
      .sort((a, b) => (parseFloat(b.offerAmount) || 0) - (parseFloat(a.offerAmount) || 0));
  }, [opinions]);

  const anonymousOpinions = useMemo(() => {
    const anon = opinions.filter(o => o.serious !== true);
    return [...anon].sort((a, b) => {
      let aVal, bVal;
      if (anonSortField === 'offerAmount') {
        aVal = parseFloat(a.offerAmount) || 0;
        bVal = parseFloat(b.offerAmount) || 0;
      } else if (anonSortField === 'createdAt') {
        const aTs = a.createdAt?.toDate ? a.createdAt.toDate() : (a.createdAt ? new Date(a.createdAt) : new Date(0));
        const bTs = b.createdAt?.toDate ? b.createdAt.toDate() : (b.createdAt ? new Date(b.createdAt) : new Date(0));
        aVal = aTs.getTime();
        bVal = bTs.getTime();
      } else {
        aVal = a[anonSortField] || '';
        bVal = b[anonSortField] || '';
      }
      return anonSortDir === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
    });
  }, [opinions, anonSortField, anonSortDir]);

  const toggleAnonSort = (field) => {
    if (anonSortField === field) {
      setAnonSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setAnonSortField(field);
      setAnonSortDir('desc');
    }
  };

  if (opinions.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <MessageSquare className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">No buyer opinions yet</p>
      </div>
    );
  }

  const AnonSortHeader = ({ field, children }) => (
    <th
      onClick={() => toggleAnonSort(field)}
      className="text-left px-4 py-3 font-semibold text-slate-600 cursor-pointer hover:text-slate-900 select-none"
    >
      <span className="flex items-center gap-1">
        {children}
        {anonSortField === field && (
          <span className="text-xs">{anonSortDir === 'asc' ? '\u2191' : '\u2193'}</span>
        )}
      </span>
    </th>
  );

  return (
    <div className="space-y-6">
      {/* Serious / Registered Buyers */}
      {seriousOpinions.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-slate-500" />
              Registered Buyers ({seriousOpinions.length})
            </h3>
          </div>
          <div className="divide-y divide-slate-100">
            {seriousOpinions.map((op) => (
              <div key={op.id} className="px-6 py-4">
                {/* Top row: name/contact + price/date */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900">
                        {op.resolvedBuyerName || op.buyerName || op.userName || 'Anonymous'}
                      </span>
                      {op.isFirstHomeBuyer && (
                        <span className="inline-flex px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-600">FHB</span>
                      )}
                      {op.isInvestor && (
                        <span className="inline-flex px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-600">Investor</span>
                      )}
                    </div>
                    {(op.resolvedEmail || op.resolvedPhone) && (
                      <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                        {op.resolvedEmail && <span>{op.resolvedEmail}</span>}
                        {op.resolvedPhone && <span>{op.resolvedPhone}</span>}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-bold text-slate-900">{formatPrice(op.offerAmount)}</div>
                    <div className="text-xs text-slate-400">{formatDate(op.createdAt)}</div>
                  </div>
                </div>

                {/* Detail grid */}
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                  <div>
                    <span className="text-slate-400">Finance</span>
                    <p className="font-semibold text-slate-700">{fmtBuyerType(op.buyerType)}</p>
                  </div>
                  <div>
                    <span className="text-slate-400">Interest Level</span>
                    <p className="font-semibold text-slate-700">{fmtInterestLevel(op.seriousnessLevel)}</p>
                  </div>
                  {op.preferredLocations?.length > 0 && (
                    <div>
                      <span className="text-slate-400">Preferred Locations</span>
                      <p className="font-semibold text-slate-700">{op.preferredLocations.join(', ')}</p>
                    </div>
                  )}
                  {op.preferredType && (
                    <div>
                      <span className="text-slate-400">Property Type</span>
                      <p className="font-semibold text-slate-700">{op.preferredType}</p>
                    </div>
                  )}
                  {op.minBedrooms && (
                    <div>
                      <span className="text-slate-400">Min Bedrooms</span>
                      <p className="font-semibold text-slate-700">{op.minBedrooms}+</p>
                    </div>
                  )}
                  {(op.minBudget || op.maxBudget) && (
                    <div>
                      <span className="text-slate-400">Budget Range</span>
                      <p className="font-semibold text-slate-700">{fmtBudget(op.minBudget) || 'Any'} – {fmtBudget(op.maxBudget) || 'Any'}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Anonymous / Passive Opinions */}
      {anonymousOpinions.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <button
            onClick={() => setShowAnonymous(!showAnonymous)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
          >
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400" />
              Anonymous Opinions ({anonymousOpinions.length})
            </h3>
            <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${showAnonymous ? 'rotate-90' : ''}`} />
          </button>
          {showAnonymous && (
            <div className="border-t border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <AnonSortHeader field="offerAmount">Price Opinion</AnonSortHeader>
                    <AnonSortHeader field="createdAt">Date</AnonSortHeader>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Badges</th>
                  </tr>
                </thead>
                <tbody>
                  {anonymousOpinions.map((op) => (
                    <tr key={op.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700 font-semibold">
                        {formatPrice(op.offerAmount)}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                        {formatDate(op.createdAt)}
                      </td>
                      <td className="px-4 py-3 space-x-1">
                        {op.isFirstHomeBuyer && (
                          <span className="inline-flex px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-200 text-slate-700">FHB</span>
                        )}
                        {op.isInvestor && (
                          <span className="inline-flex px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-200 text-slate-700">Investor</span>
                        )}
                        {!op.isFirstHomeBuyer && !op.isInvestor && (
                          <span className="text-slate-400">--</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Image Edit Modal ---
function ImageEditModal({ imageUrl, imageIndex, propertyId, userId, allImages, onClose, onApplied }) {
  const [prompt, setPrompt] = useState('');
  const [editHistory, setEditHistory] = useState([]);
  const [selectedEdit, setSelectedEdit] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const pollingRef = useRef({});
  const historyEndRef = useRef(null);

  // Track whether user has explicitly picked a thumbnail (null = original selected)
  const [hasExplicitSelection, setHasExplicitSelection] = useState(false);

  // The image shown in preview and sent to the AI
  const activeImageUrl = useMemo(() => {
    if (selectedEdit?.editedImageUrl) return selectedEdit.editedImageUrl;
    // If user explicitly clicked "Original", use original even if completed edits exist
    if (hasExplicitSelection && !selectedEdit) return imageUrl;
    const completed = [...editHistory].reverse().find(e => e.status === 'completed' && e.editedImageUrl);
    return completed?.editedImageUrl || imageUrl;
  }, [selectedEdit, hasExplicitSelection, editHistory, imageUrl]);

  // Load edit history from Firestore (realtime)
  useEffect(() => {
    if (!userId || !propertyId) return;
    const q = query(
      collection(db, 'image_edits'),
      where('userId', '==', userId),
      where('listingId', '==', propertyId),
      orderBy('createdAt', 'asc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      const edits = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Build the chain: start with edits of the original image, then include any chained edits
      const editedUrls = new Set([imageUrl]);
      let found = true;
      while (found) {
        found = false;
        for (const e of edits) {
          if (editedUrls.has(e.originalImageUrl) && e.editedImageUrl && !editedUrls.has(e.editedImageUrl)) {
            editedUrls.add(e.editedImageUrl);
            found = true;
          }
        }
      }
      const relevant = edits.filter(e => editedUrls.has(e.originalImageUrl));
      setEditHistory(relevant);
    });
    return () => unsub();
  }, [userId, propertyId, imageUrl, allImages]);

  // Poll processing edits
  useEffect(() => {
    const processing = editHistory.filter(e => e.status === 'processing' || e.status === 'pending');
    // Start polling for any processing edits not already being polled
    processing.forEach((edit) => {
      if (pollingRef.current[edit.id]) return;
      pollingRef.current[edit.id] = true;
      const poll = async () => {
        while (pollingRef.current[edit.id]) {
          try {
            const res = await authFetch(`/api/ai/image-edit?editId=${edit.id}`);
            const data = await res.json();
            if (data.status === 'completed' || data.status === 'failed') {
              delete pollingRef.current[edit.id];
              return;
            }
          } catch {
            // continue polling
          }
          await new Promise(r => setTimeout(r, 5000));
        }
      };
      poll();
    });

    // Cleanup — stop polling for edits no longer processing
    const processingIds = new Set(processing.map(e => e.id));
    Object.keys(pollingRef.current).forEach(id => {
      if (!processingIds.has(id)) delete pollingRef.current[id];
    });
  }, [editHistory]);

  // Cleanup all polling on unmount
  useEffect(() => {
    return () => { pollingRef.current = {}; };
  }, []);

  // Auto-scroll history
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [editHistory.length]);

  const handleSubmit = async () => {
    if (!prompt.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const sourceUrl = activeImageUrl;
      const parentEditId = selectedEdit?.id || null;

      const res = await authFetch('/api/ai/image-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: userId,
          propertyId,
          imageUrl: sourceUrl,
          prompt: prompt.trim(),
          parentEditId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to start edit');
        return;
      }
      setPrompt('');
      // The Firestore listener will pick up the new edit
    } catch (err) {
      setError('Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApply = async (edit) => {
    if (!edit.editedImageUrl) return;
    try {
      const res = await authFetch('/api/ai/image-edit/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: userId,
          editId: edit.id,
          propertyId,
          originalImageUrl: imageUrl,
          editedImageUrl: edit.editedImageUrl,
        }),
      });
      const data = await res.json();
      if (data.success && onApplied) {
        onApplied(data.imageUrls);
      }
    } catch {
      setError('Failed to apply edit');
    }
  };

  const previewUrl = activeImageUrl;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-purple-600" />
            <h3 className="text-lg font-bold text-slate-900">AI Image Editor</h3>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Preview Image */}
        <div className="relative w-full h-56 sm:h-64 bg-slate-900 flex-shrink-0">
          <Image
            src={previewUrl}
            alt="Edit preview"
            fill
            className="object-contain"
            unoptimized
          />
          {/* Processing overlay */}
          {editHistory.some(e => e.status === 'processing' || e.status === 'pending') && (
            <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center z-10">
              <Loader2 className="w-8 h-8 text-white animate-spin mb-2" />
              <p className="text-white text-sm font-medium">Generating edit...</p>
            </div>
          )}
          {selectedEdit && selectedEdit.status === 'completed' && (
            <div className="absolute bottom-3 right-3 flex gap-2">
              <button
                onClick={() => handleApply(selectedEdit)}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg shadow-lg transition-colors flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Apply to Listing
              </button>
            </div>
          )}
          {selectedEdit?.appliedToListing && (
            <div className="absolute top-3 left-3 px-2.5 py-1 bg-green-600 text-white text-xs font-semibold rounded-lg">
              Applied
            </div>
          )}
        </div>

        {/* Edit History Timeline */}
        {editHistory.length > 0 && (
          <div className="border-b border-slate-200 px-5 py-3">
            <p className="text-xs font-semibold text-slate-500 mb-2">Edit History</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {/* Original image thumbnail */}
              <button
                onClick={() => { setSelectedEdit(null); setHasExplicitSelection(true); }}
                className={`flex-shrink-0 relative w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                  hasExplicitSelection && !selectedEdit ? 'border-purple-500' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <Image src={imageUrl} alt="Original" fill className="object-cover" unoptimized />
                <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[9px] font-medium text-center py-0.5">
                  Original
                </div>
              </button>

              {editHistory.map((edit) => (
                <div key={edit.id} className="flex-shrink-0 relative group">
                  <button
                    onClick={() => { if (edit.status === 'completed') { setSelectedEdit(edit); setHasExplicitSelection(true); } }}
                    className={`relative w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                      selectedEdit?.id === edit.id ? 'border-purple-500' : 'border-slate-200 hover:border-slate-300'
                    } ${edit.status !== 'completed' ? 'opacity-70' : ''}`}
                  >
                    {edit.status === 'completed' && edit.editedImageUrl ? (
                      <Image src={edit.editedImageUrl} alt={edit.prompt} fill className="object-cover" unoptimized />
                    ) : (
                      <div className="w-full h-full bg-slate-100 flex items-center justify-center">
                        {(edit.status === 'processing' || edit.status === 'pending') && (
                          <Loader2 className="w-5 h-5 text-purple-500 animate-spin" />
                        )}
                        {edit.status === 'failed' && (
                          <AlertCircle className="w-5 h-5 text-red-400" />
                        )}
                      </div>
                    )}
                    <div className={`absolute bottom-0 inset-x-0 text-white text-[9px] font-medium text-center py-0.5 ${
                      edit.status === 'completed' ? 'bg-green-600/80' :
                      edit.status === 'failed' ? 'bg-red-500/80' : 'bg-purple-600/80'
                    }`}>
                      {edit.status === 'completed' ? 'Done' : edit.status === 'failed' ? 'Failed' : 'Processing'}
                    </div>
                    {edit.appliedToListing && (
                      <div className="absolute top-0.5 right-0.5 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                        <Check className="w-2.5 h-2.5 text-white" />
                      </div>
                    )}
                  </button>
                  {/* Delete button */}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (selectedEdit?.id === edit.id) setSelectedEdit(null);
                      await deleteDoc(doc(db, 'image_edits', edit.id));
                    }}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 rounded-full items-center justify-center text-white shadow-md transition-colors hidden group-hover:flex z-10"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <div ref={historyEndRef} />
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="mx-5 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Prompt Input */}
        <div className="p-5 mt-auto">
          <div className="flex gap-2">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="Describe your edit... e.g. &quot;Remove clutter from bench&quot;"
              className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              disabled={submitting}
            />
            <button
              onClick={handleSubmit}
              disabled={!prompt.trim() || submitting}
              className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {submitting ? 'Sending...' : 'Edit'}
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Editing the {selectedEdit ? 'selected edit' : 'original image'}. Click a thumbnail above to change source.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- Main Report Page ---
export default function PropertyReportPage() {
  useRequireAgent();
  const { user, userData, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const propertyId = params.id;

  const [property, setProperty] = useState(null);
  const [offers, setOffers] = useState([]);
  const [likes, setLikes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [showSoldConfirm, setShowSoldConfirm] = useState(false);
  const [markingSold, setMarkingSold] = useState(false);
  const [soldPriceInput, setSoldPriceInput] = useState('');
  const [soldDateInput, setSoldDateInput] = useState(() => new Date().toISOString().split('T')[0]);
  const [showUnsoldConfirm, setShowUnsoldConfirm] = useState(false);
  const [restoringActive, setRestoringActive] = useState(false);
  const [generatingCard, setGeneratingCard] = useState(false);
  const [showSendReport, setShowSendReport] = useState(false);
  const [sendingReport, setSendingReport] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [reportEmail, setReportEmail] = useState('');
  const [reportName, setReportName] = useState('');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showImageEdit, setShowImageEdit] = useState(false);
  const [editingImageUrl, setEditingImageUrl] = useState(null);
  const [editingImageIndex, setEditingImageIndex] = useState(0);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/join');
    }
  }, [user, authLoading, router]);

  // Fetch property + offers + likes
  useEffect(() => {
    if (!user || !propertyId) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const [propertySnap, offersSnap, likesSnap] = await Promise.all([
          getDoc(doc(db, 'properties', propertyId)),
          getDocs(query(collection(db, 'offers'), where('propertyId', '==', propertyId))),
          getDocs(query(collection(db, 'likes'), where('propertyId', '==', propertyId))),
        ]);

        if (propertySnap.exists()) {
          const propData = { id: propertySnap.id, ...propertySnap.data() };
          // Verify ownership
          if (propData.userId !== user.uid && !userData?.superAdmin) {
            router.push('/dashboard');
            return;
          }
          setProperty(propData);
        } else {
          router.push('/dashboard');
          return;
        }

        const rawOffers = offersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Batch-fetch user docs for serious offers with userId
        const seriousWithUserId = rawOffers.filter(o => o.type === 'opinion' && o.serious === true && o.userId);
        const uniqueUserIds = [...new Set(seriousWithUserId.map(o => o.userId))];
        const userMap = {};
        if (uniqueUserIds.length > 0) {
          const userSnaps = await Promise.all(
            uniqueUserIds.map(uid => getDoc(doc(db, 'users', uid)))
          );
          userSnaps.forEach(snap => {
            if (snap.exists()) userMap[snap.id] = snap.data();
          });
        }

        // Enrich offers with resolved buyer name, contact info, and preferences.
        // Prefer user-profile data (resolved from userId); fall back to whatever
        // was captured directly on the offer (e.g. iPad kiosk flow).
        const enrichedOffers = rawOffers.map(o => {
          if (o.type === 'opinion' && o.serious === true && o.userId && userMap[o.userId]) {
            const u = userMap[o.userId];
            const resolvedName = (u.firstName && u.lastName)
              ? `${u.firstName} ${u.lastName}`.trim()
              : (u.firstName || o.buyerName || o.userName || null);
            const prefs = u.buyerPreferences || {};
            return {
              ...o,
              resolvedBuyerName: resolvedName,
              resolvedEmail: u.email || o.buyerEmail || null,
              resolvedPhone: u.phone || o.buyerPhone || null,
              preferredLocations: prefs.locations || [],
              preferredType: prefs.propertyType || null,
              minBedrooms: prefs.minBedrooms || null,
              minBudget: prefs.minBudget || null,
              maxBudget: prefs.maxBudget || null,
            };
          }
          // No linked user profile — use contact info captured on the offer itself
          return {
            ...o,
            resolvedBuyerName: o.buyerName || o.userName || null,
            resolvedEmail: o.buyerEmail || null,
            resolvedPhone: o.buyerPhone || null,
          };
        });

        setOffers(enrichedOffers);
        setLikes(likesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Error fetching report data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user, propertyId, router]);

  const toggleVisibility = async () => {
    if (!property) return;
    setToggling(true);
    try {
      const newVisibility = !property.visibility;
      await updateDoc(doc(db, 'properties', property.id), { visibility: newVisibility });
      setProperty(prev => ({ ...prev, visibility: newVisibility }));
    } catch (err) {
      console.error('Error toggling visibility:', err);
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async () => {
    if (!property) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'properties', property.id));
      router.push('/dashboard');
    } catch (err) {
      console.error('Error deleting property:', err);
      setDeleting(false);
    }
  };

  const handleArchive = async () => {
    if (!property) return;
    setArchiving(true);
    try {
      if (property.archived) {
        await updateDoc(doc(db, 'properties', property.id), { archived: false });
        setProperty(prev => ({ ...prev, archived: false }));
      } else {
        await updateDoc(doc(db, 'properties', property.id), { archived: true, visibility: false });
        router.push('/dashboard');
      }
    } catch (err) {
      console.error('Error archiving property:', err);
    } finally {
      setArchiving(false);
    }
  };

  // Marks the existing property record as sold — no duplication, no new
  // collection. Reuses the same field shape as the pre-existing
  // /dashboard/property/[id]/sold email-follow-up flow, so every place in
  // the app that already treats `archived: true` as "not active" (scoring,
  // invoicing, buyer feeds, cron jobs) picks this up automatically.
  const handleMarkSold = async () => {
    if (!property) return;
    setMarkingSold(true);
    try {
      const trimmedPrice = soldPriceInput.trim();
      const parsedPrice = trimmedPrice ? parseFloat(trimmedPrice.replace(/[^0-9.]/g, '')) : null;
      const cleanPrice = parsedPrice != null && !isNaN(parsedPrice) ? parsedPrice : null;
      const cleanDate = soldDateInput ? new Date(soldDateInput) : new Date();
      // Remember the visibility it had before being marked sold, so
      // "Move Back to Active" can restore it exactly rather than guessing.
      const preSoldVisibility = property.visibility === true;

      await updateDoc(doc(db, 'properties', property.id), {
        soldPrice: cleanPrice,
        soldAt: cleanDate,
        archived: true,
        active: false,
        visibility: false,
        archivedAt: serverTimestamp(),
        archivedReason: 'sold',
        preSoldVisibility,
      });
      setProperty(prev => ({
        ...prev,
        soldPrice: cleanPrice,
        soldAt: cleanDate,
        archived: true,
        active: false,
        visibility: false,
        archivedReason: 'sold',
        preSoldVisibility,
      }));
      setShowSoldConfirm(false);
    } catch (err) {
      console.error('Error marking property sold:', err);
      alert('Failed to mark property as sold. Please try again.');
    } finally {
      setMarkingSold(false);
    }
  };

  // Full reversal: restores the property to exactly the state a property
  // that was never marked sold would be in. Every sold-specific field is
  // removed outright (not just set to false/null) so no sold badge, sold
  // price/date, or other sold metadata can linger on the card or page.
  // Historical opinions/views/enquiries live in separate collections and
  // are never touched by this.
  const handleRestoreActive = async () => {
    if (!property) return;
    setRestoringActive(true);
    try {
      const restoredVisibility = property.preSoldVisibility === true;
      await updateDoc(doc(db, 'properties', property.id), {
        archived: false,
        active: true,
        visibility: restoredVisibility,
        archivedReason: deleteField(),
        soldPrice: deleteField(),
        soldAt: deleteField(),
        archivedAt: deleteField(),
        preSoldVisibility: deleteField(),
      });
      setProperty(prev => {
        const next = { ...prev, archived: false, active: true, visibility: restoredVisibility };
        delete next.archivedReason;
        delete next.soldPrice;
        delete next.soldAt;
        delete next.archivedAt;
        delete next.preSoldVisibility;
        return next;
      });
      setShowUnsoldConfirm(false);
    } catch (err) {
      console.error('Error restoring property to active:', err);
      alert('Failed to move property back to active. Please try again.');
    } finally {
      setRestoringActive(false);
    }
  };

  // Downloads/shares a 1080x1350 campaign-results image for this property.
  // Entirely read-only: the PNG is generated server-side from the same
  // property + offers data this Report already reads. Nothing here writes
  // to Firestore, and none of the Report's own calculations are touched.
  const handleDownloadShareableCard = async () => {
    if (!property || generatingCard) return;
    setGeneratingCard(true);
    try {
      const res = await authFetch('/api/reports/property-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: property.id }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to generate the shareable card. Please try again.');
      }

      const blob = await res.blob();
      const addressSlug = (property.formattedAddress || property.address || 'property')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'property';
      const filename = `premarket-${addressSlug}-campaign-results.png`;

      const downloadBlob = () => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      };

      let file = null;
      try {
        file = new File([blob], filename, { type: 'image/png' });
      } catch {
        // File constructor unsupported — fall through to direct download.
      }

      const canUseNativeShare = !!file
        && typeof navigator !== 'undefined'
        && typeof navigator.canShare === 'function'
        && navigator.canShare({ files: [file] });

      if (canUseNativeShare) {
        try {
          await navigator.share({
            files: [file],
            title: 'Premarket Campaign Results',
            text: property.formattedAddress || property.address || 'Premarket campaign results',
          });
        } catch (shareErr) {
          // AbortError means the agent dismissed the native share sheet —
          // respect that and do nothing further. Any other failure falls
          // back to a direct download so the agent still gets the image.
          if (shareErr?.name !== 'AbortError') {
            console.error('Native share failed, falling back to download:', shareErr);
            downloadBlob();
          }
        }
      } else {
        downloadBlob();
      }
    } catch (err) {
      console.error('Error generating shareable card:', err);
      alert(err.message || 'Failed to generate the shareable card. Please try again.');
    } finally {
      setGeneratingCard(false);
      setShowMoreMenu(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    );
  }

  if (!user || !property) return null;

  const propertyUrl = `https://premarket.homes/find-property?propertyId=${property.id}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(propertyUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const input = document.createElement('input');
      input.value = propertyUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Computed data
  const opinions = offers.filter(o => o.type === 'opinion');
  const seriousBuyers = opinions.filter(o => o.serious === true);
  const passiveBuyers = opinions.filter(o => o.serious !== true);

  const seriousAmounts = seriousBuyers.map(o => parseFloat(o.offerAmount) || 0).filter(a => a > 0);
  const passiveAmounts = passiveBuyers.map(o => parseFloat(o.offerAmount) || 0).filter(a => a > 0);
  const allAmounts = [...seriousAmounts, ...passiveAmounts];

  const listingPrice = parseFloat(String(property.price).replace(/[^0-9.]/g, '')) || 0;
  const combinedMedian = median(allAmounts);
  const priceDiff = combinedMedian && listingPrice
    ? ((combinedMedian - listingPrice) / listingPrice * 100).toFixed(1)
    : null;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between gap-3">
            {/* Left: Back + Title */}
            <div className="flex items-center gap-3 min-w-0">
              <Link href="/dashboard" className="p-2 hover:bg-slate-100 rounded-lg transition-colors shrink-0">
                <ArrowLeft className="w-5 h-5 text-slate-600" />
              </Link>
              <div className="min-w-0">
                <h1 className="text-base font-bold text-slate-900 truncate">{property.title || 'Property Report'}</h1>
                <p className="text-xs text-slate-500 truncate">{property.formattedAddress || property.address}</p>
              </div>
            </div>

            {/* Right: Key actions */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Visibility toggle */}
              <button
                onClick={toggleVisibility}
                disabled={toggling}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  property.visibility
                    ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {property.visibility ? (
                  <>
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    Public
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                    Private
                  </>
                )}
              </button>

              {/* Send Report - primary action */}
              <button
                onClick={() => { setShowSendReport(true); setReportSent(false); setReportEmail(''); setReportName(''); }}
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-orange-500 text-white hover:bg-orange-600 transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                Send Report
              </button>

              {/* More menu */}
              <div className="relative">
                <button
                  onClick={() => setShowMoreMenu(!showMoreMenu)}
                  className="flex items-center gap-1.5 px-3 py-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500"
                >
                  <MoreVertical className="w-4 h-4" />
                  <span className="text-xs font-medium hidden sm:inline">Settings</span>
                </button>

                {showMoreMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowMoreMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-20">
                      {/* Copy Link */}
                      <button
                        onClick={() => { copyLink(); setShowMoreMenu(false); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-slate-400" />}
                        {copied ? 'Copied!' : 'Copy Link'}
                      </button>
                      {/* Preview */}
                      <a
                        href={propertyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setShowMoreMenu(false)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <ExternalLink className="w-4 h-4 text-slate-400" />
                        Preview Listing
                      </a>
                      {/* iPad mode */}
                      <a
                        href={`/find-property?propertyId=${property.id}&mode=ipad`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setShowMoreMenu(false)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <Tablet className="w-4 h-4 text-slate-400" />
                        Open Home (iPad)
                      </a>
                      <div className="border-t border-slate-100 my-1.5" />
                      {/* Edit */}
                      <Link
                        href={`/dashboard/edit/${property.id}`}
                        onClick={() => setShowMoreMenu(false)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <Pencil className="w-4 h-4 text-slate-400" />
                        Edit Property
                      </Link>
                      {/* Send Report - mobile */}
                      <button
                        onClick={() => { setShowSendReport(true); setReportSent(false); setReportEmail(''); setReportName(''); setShowMoreMenu(false); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors sm:hidden"
                      >
                        <Send className="w-4 h-4 text-slate-400" />
                        Send Report
                      </button>
                      {/* Download Shareable Property Card */}
                      <button
                        onClick={handleDownloadShareableCard}
                        disabled={generatingCard}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                      >
                        {generatingCard ? (
                          <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4 text-slate-400" />
                        )}
                        {generatingCard ? 'Generating card...' : 'Download Shareable Property Card'}
                      </button>
                      {/* Archive */}
                      <button
                        onClick={() => { handleArchive(); setShowMoreMenu(false); }}
                        disabled={archiving}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                      >
                        <Archive className="w-4 h-4 text-slate-400" />
                        {property.archived ? 'Unarchive' : 'Archive'}
                      </button>
                      <div className="border-t border-slate-100 my-1.5" />
                      {/* Delete */}
                      <button
                        onClick={() => { setShowDeleteConfirm(true); setShowMoreMenu(false); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete Property
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Property Header */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Media Gallery (Video + Images) */}
          <div className="lg:col-span-3">
            <MediaGallery
              images={property.imageUrls}
              videoUrl={property.aiVideo?.url || property.videoUrl}
              onEditImage={(url, idx) => {
                setEditingImageUrl(url);
                setEditingImageIndex(idx);
                setShowImageEdit(true);
              }}
            />
          </div>

          {/* Property Info */}
          <div className="lg:col-span-2 space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className={`inline-flex px-2.5 py-1 text-xs font-semibold rounded-full ${
                  property.archivedReason === 'sold'
                    ? 'bg-emerald-100 text-emerald-700'
                    : property.archived
                      ? 'bg-amber-100 text-amber-700'
                      : property.visibility
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-500'
                }`}>
                  {property.archivedReason === 'sold' ? 'Sold' : property.archived ? 'Archived' : property.visibility ? 'Public' : 'Private'}
                </span>
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-1">
                {property.title || property.formattedAddress || property.address || 'Property'}
              </h2>
              <p className="text-sm text-slate-500 mb-3">{property.formattedAddress || property.address}</p>
              <p className="text-2xl font-bold text-slate-900 mb-4">{formatPrice(property.price)}</p>
            </div>

            <div className="flex items-center gap-4 text-sm text-slate-600">
              {property.bedrooms != null && (
                <span className="flex items-center gap-1.5"><Bed className="w-4 h-4 text-slate-400" />{property.bedrooms} Bed</span>
              )}
              {property.bathrooms != null && (
                <span className="flex items-center gap-1.5"><Bath className="w-4 h-4 text-slate-400" />{property.bathrooms} Bath</span>
              )}
              {property.carSpaces != null && (
                <span className="flex items-center gap-1.5"><Car className="w-4 h-4 text-slate-400" />{property.carSpaces} Car</span>
              )}
            </div>

          </div>
        </div>

        {/* Engagement Overview */}
        <div>
          <h3 className="text-lg font-bold text-slate-900 mb-3">Engagement</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <EngagementCard label="Total Views" value={property.stats?.views || 0} icon={Eye} />
            <EngagementCard label="Total Likes" value={likes.length} icon={Heart} />
            <EngagementCard label="Price Opinions" value={opinions.length} icon={MessageSquare} />
            <EngagementCard label="Serious Buyers" value={seriousBuyers.length} icon={UserCheck} />
          </div>
        </div>

        {/* Price Intelligence */}
        <div>
          <h3 className="text-lg font-bold text-slate-900 mb-3">Price Intelligence</h3>

          {/* Listing vs Median comparison */}
          {listingPrice > 0 && combinedMedian > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 mb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-500 mb-1">Listing Price</p>
                  <p className="text-2xl font-bold text-slate-900">{formatPrice(listingPrice)}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-slate-500 mb-1">vs Median Opinion</p>
                  <p className={`text-lg font-bold ${
                    priceDiff > 0 ? 'text-slate-900' : priceDiff < 0 ? 'text-slate-900' : 'text-slate-600'
                  }`}>
                    {priceDiff > 0 ? '+' : ''}{priceDiff}%
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-slate-500 mb-1">Combined Median</p>
                  <p className="text-2xl font-bold text-slate-900">{formatPrice(combinedMedian)}</p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <MedianCard label="Serious Buyer Median" value={median(seriousAmounts)} />
            <MedianCard label="Passive Buyer Median" value={median(passiveAmounts)} />
            <MedianCard label="Combined Median" value={median(allAmounts)} />
          </div>

          {/* Price Range */}
          {allAmounts.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">Lowest Opinion</p>
                <p className="text-sm font-bold text-slate-900">{formatPrice(Math.min(...allAmounts))}</p>
              </div>
              <div className="flex-1 mx-4 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-slate-300 via-slate-500 to-slate-800 rounded-full" />
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">Highest Opinion</p>
                <p className="text-sm font-bold text-slate-900">{formatPrice(Math.max(...allAmounts))}</p>
              </div>
            </div>
          )}
        </div>

        {/* Price Distribution + Buyer Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <PriceDistribution opinions={opinions} />
          <BuyerBreakdown
            seriousBuyers={seriousBuyers}
            passiveBuyers={passiveBuyers}
            opinions={opinions}
          />
        </div>

        {/* Price Timeline */}
        <PriceTimeline opinions={opinions} />

        {/* Opinions Table */}
        <OpinionsTable opinions={opinions} />

        {/* Sold Status Action — internal agent/admin control, never shown on the public property page */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          {property.archivedReason === 'sold' ? (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-900 mb-1">This property is marked as sold</p>
                <p className="text-xs text-slate-500">
                  {property.soldPrice ? `Sold for ${formatPrice(property.soldPrice)}` : 'Sold price not recorded'}
                  {property.soldAt ? ` · ${formatDate(property.soldAt)}` : ''}
                </p>
              </div>
              <button
                onClick={() => setShowUnsoldConfirm(true)}
                className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 transition-colors flex items-center justify-center gap-2 shrink-0"
              >
                <RotateCcw className="w-4 h-4" />
                Move Back to Active
              </button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-900 mb-1">Sold this property?</p>
                <p className="text-xs text-slate-500">Mark it as sold to move it out of your active campaigns and into the Sold section.</p>
              </div>
              <button
                onClick={() => { setSoldPriceInput(''); setSoldDateInput(new Date().toISOString().split('T')[0]); setShowSoldConfirm(true); }}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 shrink-0"
              >
                <CheckCircle2 className="w-4 h-4" />
                Mark as Sold
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mark as Sold Confirmation Modal */}
      <AnimatePresence>
        {showSoldConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onMouseDown={(e) => { if (e.target === e.currentTarget && !markingSold) setShowSoldConfirm(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full"
            >
              <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 text-center mb-2">Mark this property as sold?</h3>
              <p className="text-sm text-slate-500 text-center mb-5">
                It will move out of your active campaigns into the Sold section. All existing opinions, views and reports are preserved.
              </p>
              <div className="space-y-3 mb-6">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Sale Price <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={soldPriceInput}
                      onChange={(e) => setSoldPriceInput(e.target.value)}
                      placeholder="e.g. 850000"
                      className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Sale Date</label>
                  <input
                    type="date"
                    value={soldDateInput}
                    onChange={(e) => setSoldDateInput(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowSoldConfirm(false)}
                  disabled={markingSold}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleMarkSold}
                  disabled={markingSold}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                  {markingSold ? 'Confirming...' : 'Confirm Sold'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Move Back to Active Confirmation Modal */}
      <AnimatePresence>
        {showUnsoldConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onMouseDown={(e) => { if (e.target === e.currentTarget && !restoringActive) setShowUnsoldConfirm(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full"
            >
              <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                <RotateCcw className="w-6 h-6 text-slate-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 text-center mb-2">Move back to active?</h3>
              <p className="text-sm text-slate-500 text-center mb-6">
                This property will return to your active campaigns. Its sold price and date are kept, not deleted.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowUnsoldConfirm(false)}
                  disabled={restoringActive}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRestoreActive}
                  disabled={restoringActive}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  {restoringActive ? 'Restoring...' : 'Move Back to Active'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setShowDeleteConfirm(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full"
            >
              <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-6 h-6 text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 text-center mb-2">Delete Property</h3>
              <p className="text-sm text-slate-500 text-center mb-6">
                Are you sure? This action cannot be undone. All data associated with this property will be permanently removed.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 text-white font-semibold hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Send Report Modal */}
      <AnimatePresence>
        {showSendReport && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onMouseDown={(e) => { if (e.target === e.currentTarget && !sendingReport) setShowSendReport(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full"
            >
              {reportSent ? (
                <div className="text-center py-4">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4"
                  >
                    <Check className="w-7 h-7 text-green-500" />
                  </motion.div>
                  <h3 className="text-lg font-bold text-slate-900 mb-1">Report Sent!</h3>
                  <p className="text-sm text-slate-500 mb-5">The report has been emailed to {reportEmail}</p>
                  <button
                    onClick={() => setShowSendReport(false)}
                    className="px-6 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition-colors"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => setShowSendReport(false)}
                    className="absolute top-4 right-4 p-1 hover:bg-slate-100 rounded-lg transition-colors text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <div className="w-12 h-12 bg-orange-50 rounded-xl flex items-center justify-center mx-auto mb-4">
                    <FileText className="w-6 h-6 text-orange-500" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 text-center mb-1">Send Report</h3>
                  <p className="text-sm text-slate-500 text-center mb-5">Email a PDF report with property insights and buyer data.</p>
                  <div className="space-y-3 mb-5">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">Recipient Name</label>
                      <input
                        type="text"
                        value={reportName}
                        onChange={(e) => setReportName(e.target.value)}
                        placeholder="e.g. John Smith"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">Email Address</label>
                      <input
                        type="email"
                        value={reportEmail}
                        onChange={(e) => setReportEmail(e.target.value)}
                        placeholder="e.g. john@example.com"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-all"
                      />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowSendReport(false)}
                      disabled={sendingReport}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        if (!reportEmail) return;
                        setSendingReport(true);
                        try {
                          const res = await authFetch('/api/send-report', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email: reportEmail, name: reportName, propertyId: property.id }),
                          });
                          if (!res.ok) throw new Error('Failed to send');
                          setReportSent(true);
                        } catch (err) {
                          console.error('Error sending report:', err);
                          alert('Failed to send report. Please try again.');
                        } finally {
                          setSendingReport(false);
                        }
                      }}
                      disabled={sendingReport || !reportEmail}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-orange-500 text-white font-semibold hover:bg-orange-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {sendingReport ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Mail className="w-4 h-4" />
                          Send
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Image Edit Modal */}
      <AnimatePresence>
        {showImageEdit && editingImageUrl && (
          <ImageEditModal
            imageUrl={editingImageUrl}
            imageIndex={editingImageIndex}
            propertyId={propertyId}
            userId={user?.uid}
            allImages={property?.imageUrls}
            onClose={() => {
              setShowImageEdit(false);
              setEditingImageUrl(null);
            }}
            onApplied={(newImageUrls) => {
              setProperty(prev => ({ ...prev, imageUrls: newImageUrls }));
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
