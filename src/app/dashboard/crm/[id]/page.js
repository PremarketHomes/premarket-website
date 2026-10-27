'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '../../../context/AuthContext';
import { db } from '../../../firebase/clientApp';
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  ShoppingCart,
  Home,
  Users,
  ChevronDown,
  ChevronUp,
  Heart,
  MessageSquare,
  UserCheck,
  Eye,
  Loader2,
  MapPin,
  Bed,
  DollarSign,
} from 'lucide-react';
import { formatDate, formatRelative, formatPrice } from '../../../utils/formatters';
import { loginUrlForCurrentPage } from '../../../utils/loginRedirect';

function scoreColor(score) {
  if (score >= 61) return 'text-emerald-600';
  if (score >= 41) return 'text-amber-600';
  return 'text-red-500';
}

function scoreBarColor(score) {
  if (score >= 61) return 'bg-emerald-500';
  if (score >= 41) return 'bg-amber-500';
  return 'bg-red-400';
}

const TYPE_BADGES = {
  isAgent: { label: 'Agent', color: 'bg-blue-100 text-blue-700' },
  isHomeowner: { label: 'Homeowner', color: 'bg-amber-100 text-amber-700' },
  isBuyer: { label: 'Buyer', color: 'bg-emerald-100 text-emerald-700' },
};

const INTENT_STYLES = {
  buyer: { label: 'Buyer', color: 'bg-blue-100 text-blue-700' },
  seller: { label: 'Seller', color: 'bg-orange-100 text-orange-700' },
  both: { label: 'Buyer + Seller', color: 'bg-purple-100 text-purple-700' },
  passive: { label: 'Passive', color: 'bg-slate-100 text-slate-500' },
};

const SERIOUSNESS_LABELS = {
  ready_to_buy: 'Ready to Buy',
  very_interested: 'Very Interested',
  interested: 'Interested',
  just_browsing: 'Just Browsing',
};

// ─── Buyer-Seller Overlap SVG ────────────────────────────────────────────────

function BuyerSellerOverlap({ buyerScore, sellerScore }) {
  const maxScore = Math.max(buyerScore, sellerScore, 1);
  const minScore = Math.min(buyerScore, sellerScore);
  const overlap = maxScore > 0 ? minScore / maxScore : 0;

  // Circle radii proportional to score (30-60px range)
  const buyerR = 30 + (buyerScore / 100) * 30;
  const sellerR = 30 + (sellerScore / 100) * 30;

  // Center positions: closer together = more overlap
  const separation = 120 - overlap * 60;
  const cx = 160;
  const buyerCx = cx - separation / 2;
  const sellerCx = cx + separation / 2;
  const cy = 80;

  return (
    <div className="flex flex-col items-center">
      <svg width="320" height="160" viewBox="0 0 320 160" className="mx-auto">
        {/* Buyer circle */}
        <circle cx={buyerCx} cy={cy} r={buyerR} fill="rgba(59, 130, 246, 0.2)" stroke="rgb(59, 130, 246)" strokeWidth="2" />
        {/* Seller circle */}
        <circle cx={sellerCx} cy={cy} r={sellerR} fill="rgba(249, 115, 22, 0.2)" stroke="rgb(249, 115, 22)" strokeWidth="2" />
        {/* Labels */}
        <text x={buyerCx - 10} y={cy - 8} textAnchor="middle" className="text-xs font-medium fill-blue-700">Buyer</text>
        <text x={buyerCx - 10} y={cy + 12} textAnchor="middle" className="text-lg font-bold fill-blue-600">{buyerScore}</text>
        <text x={sellerCx + 10} y={cy - 8} textAnchor="middle" className="text-xs font-medium fill-orange-700">Seller</text>
        <text x={sellerCx + 10} y={cy + 12} textAnchor="middle" className="text-lg font-bold fill-orange-600">{sellerScore}</text>
      </svg>
      <div className="flex items-center gap-6 text-xs text-slate-500 mt-1">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-blue-400/40 border border-blue-500" />
          Buyer Score
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-orange-400/40 border border-orange-500" />
          Seller Score
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ContactProfile() {
  const { user, userData, loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const contactId = params.id;

  const [contact, setContact] = useState(null);
  const [loadingContact, setLoadingContact] = useState(true);
  const [offers, setOffers] = useState([]);
  const [properties, setProperties] = useState([]);
  const [showBreakdown, setShowBreakdown] = useState(false);

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
    if (!contactId || !user || userData?.superAdmin !== true) return;

    async function fetchContact() {
      setLoadingContact(true);
      try {
        const contactDoc = await getDoc(doc(db, 'contacts', contactId));
        if (!contactDoc.exists()) {
          router.push('/dashboard/crm');
          return;
        }
        const data = { id: contactDoc.id, ...contactDoc.data() };
        setContact(data);

        // Fetch related offers and properties
        const email = data.email;
        const opinionPropertyIds = data.opinionPropertyIds || [];
        const ownedPropertyIds = data.ownedPropertyIds || [];

        const allPropertyIds = [...new Set([...opinionPropertyIds, ...ownedPropertyIds])];

        // Fetch offers by email
        if (email) {
          const offersSnap = await getDocs(
            query(collection(db, 'offers'), where('email', '==', email))
          );
          const offersData = offersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          // Also try buyerEmail
          const offersSnap2 = await getDocs(
            query(collection(db, 'offers'), where('buyerEmail', '==', email))
          );
          const offersData2 = offersSnap2.docs.map((d) => ({ id: d.id, ...d.data() }));
          const combined = [...offersData, ...offersData2];
          const unique = Array.from(new Map(combined.map((o) => [o.id, o])).values());
          setOffers(unique.sort((a, b) => {
            const at = a.createdAt?.toDate?.()?.getTime() || 0;
            const bt = b.createdAt?.toDate?.()?.getTime() || 0;
            return bt - at;
          }));
        }

        // Fetch properties by IDs (in chunks of 10 for Firestore 'in' queries)
        if (allPropertyIds.length > 0) {
          const props = [];
          for (let i = 0; i < allPropertyIds.length; i += 10) {
            const chunk = allPropertyIds.slice(i, i + 10);
            const snap = await getDocs(
              query(collection(db, 'properties'), where('__name__', 'in', chunk))
            );
            props.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          }
          setProperties(props);
        }
      } catch (err) {
        console.error('Failed to load contact:', err);
      }
      setLoadingContact(false);
    }
    fetchContact();
  }, [contactId, user, userData, router]);

  if (loading || !user || userData?.superAdmin !== true || loadingContact) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    );
  }

  if (!contact) return null;

  const propertiesByOpinion = properties.filter((p) => contact.opinionPropertyIds?.includes(p.id));
  const propertiesOwned = properties.filter((p) => contact.ownedPropertyIds?.includes(p.id));

  // Build activity feed
  const activityFeed = [];
  for (const offer of offers) {
    const prop = properties.find((p) => p.id === offer.propertyId);
    const addr = prop?.formattedAddress || prop?.address || offer.propertyId;
    if (offer.serious === true) {
      activityFeed.push({
        type: 'registered_interest',
        icon: UserCheck,
        description: `Registered serious interest in ${addr}`,
        time: offer.createdAt,
        color: 'text-emerald-500',
      });
    }
    if (offer.offerAmount) {
      activityFeed.push({
        type: 'opinion',
        icon: MessageSquare,
        description: `Submitted price opinion of ${formatPrice(offer.offerAmount)} on ${addr}`,
        time: offer.createdAt,
        color: 'text-blue-500',
      });
    }
  }
  activityFeed.sort((a, b) => {
    const at = a.time?.toDate?.()?.getTime() || a.time?.getTime?.() || 0;
    const bt = b.time?.toDate?.()?.getTime() || b.time?.getTime?.() || 0;
    return bt - at;
  });

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-4">
          <Link href="/dashboard/crm" className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <h1 className="text-lg font-bold text-slate-900">Contact Profile</h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* ─── Profile Header ──────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl border border-slate-200 p-6"
        >
          <div className="flex items-start gap-4">
            {contact.avatar ? (
              <img src={contact.avatar} alt="" className="w-16 h-16 rounded-full object-cover" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white text-xl font-bold shrink-0">
                {(contact.firstName?.[0] || contact.email?.[0] || '?').toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-slate-900">
                {contact.firstName || ''} {contact.lastName || ''}
              </h2>
              {contact.email && (
                <div className="flex items-center gap-1.5 text-sm text-slate-500 mt-1">
                  <Mail className="w-3.5 h-3.5" />
                  {contact.email}
                </div>
              )}
              {contact.phone && (
                <div className="flex items-center gap-1.5 text-sm text-slate-500 mt-0.5">
                  <Phone className="w-3.5 h-3.5" />
                  {contact.phone}
                </div>
              )}

              {/* Type + Intent badges */}
              <div className="flex flex-wrap gap-2 mt-3">
                {Object.entries(TYPE_BADGES).map(([key, badge]) =>
                  contact[key] ? (
                    <span key={key} className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${badge.color}`}>
                      {badge.label}
                    </span>
                  ) : null
                )}
                {contact.intentLabel && (
                  <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${INTENT_STYLES[contact.intentLabel]?.color || INTENT_STYLES.passive.color}`}>
                    {INTENT_STYLES[contact.intentLabel]?.label || 'Passive'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </motion.div>

        {/* ─── Buyer-Seller Overlap ───────────────────────────────────── */}
        {(contact.buyerScore > 0 || contact.sellerScore > 0) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-white rounded-xl border border-slate-200 p-6"
          >
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Buyer-Seller Overlap</h3>
            <BuyerSellerOverlap buyerScore={contact.buyerScore || 0} sellerScore={contact.sellerScore || 0} />
          </motion.div>
        )}

        {/* ─── Score Cards ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <ScoreCard label="Buyer Score" value={contact.buyerScore || 0} />
          <ScoreCard label="Seller Score" value={contact.sellerScore || 0} />
          <StatCard label="Total Opinions" value={contact.totalPriceOpinions || 0} />
          <StatCard label="Registered Interest" value={contact.totalRegisteredInterest || 0} />
        </div>

        {/* ─── Scoring Breakdown ──────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-xl border border-slate-200"
        >
          <button
            onClick={() => setShowBreakdown(!showBreakdown)}
            className="w-full flex items-center justify-between p-4 text-left"
          >
            <span className="text-sm font-semibold text-slate-900">Scoring Breakdown</span>
            {showBreakdown ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>
          {showBreakdown && (
            <div className="px-4 pb-4 space-y-4">
              {contact.isBuyer && (
                <div>
                  <h4 className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-2">Buyer Score Factors</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <Factor label="Opinions" value={`${contact.totalPriceOpinions || 0} / 20`} pct={Math.min((contact.totalPriceOpinions || 0) / 20, 1)} weight="20%" />
                    <Factor label="Serious Registrations" value={`${contact.totalRegisteredInterest || 0} / 5`} pct={Math.min((contact.totalRegisteredInterest || 0) / 5, 1)} weight="30%" />
                    <Factor label="Seriousness Level" value={SERIOUSNESS_LABELS[contact.seriousnessLevel] || 'None'} pct={({ ready_to_buy: 1, very_interested: 0.75, interested: 0.5, just_browsing: 0.25 })[contact.seriousnessLevel] || 0} weight="20%" />
                    <Factor label="Likes" value={`${contact.totalLikes || 0} / 10`} pct={Math.min((contact.totalLikes || 0) / 10, 1)} weight="15%" />
                  </div>
                </div>
              )}
              {contact.isHomeowner && (
                <div>
                  <h4 className="text-xs font-semibold text-orange-600 uppercase tracking-wider mb-2">Seller Score Factors</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <Factor label="Properties as Client" value={`${contact.ownedPropertyIds?.length || 0} / 3`} pct={Math.min((contact.ownedPropertyIds?.length || 0) / 3, 1)} weight="30%" />
                    <Factor label="Eagerness" value={contact.eagernessLevel <= 0.5 ? 'Very Serious' : contact.eagernessLevel <= 1.5 ? 'Serious' : 'Testing'} pct={contact.eagernessLevel <= 0.5 ? 1 : contact.eagernessLevel <= 1.5 ? 0.6 : 0.2} weight="30%" />
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>

        {/* ─── Activity Feed ──────────────────────────────────────────── */}
        {activityFeed.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-white rounded-xl border border-slate-200 p-6"
          >
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Activity</h3>
            <div className="space-y-3">
              {activityFeed.slice(0, 20).map((item, i) => {
                const Icon = item.icon;
                return (
                  <div key={i} className="flex items-start gap-3">
                    <div className={`mt-0.5 ${item.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-700">{item.description}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{formatRelative(item.time)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* ─── Linked Properties: Buyer ───────────────────────────────── */}
        {propertiesByOpinion.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-xl border border-slate-200 p-6"
          >
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Properties Opined On</h3>
            <div className="space-y-2">
              {propertiesByOpinion.map((p) => {
                const opinion = offers.find((o) => o.propertyId === p.id && o.offerAmount);
                const listingPrice = parseFloat(String(p.price || '').replace(/[^0-9.]/g, ''));
                const opinionAmount = opinion ? parseFloat(String(opinion.offerAmount).replace(/[^0-9.]/g, '')) : null;
                const deviation = opinionAmount && listingPrice ? Math.round(((opinionAmount - listingPrice) / listingPrice) * 100) : null;
                return (
                  <div key={p.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{p.formattedAddress || p.address || p.id}</p>
                      <p className="text-xs text-slate-500">Listed: {formatPrice(p.price)}</p>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      {opinionAmount && <p className="text-sm font-medium text-slate-700">Opinion: {formatPrice(opinionAmount)}</p>}
                      {deviation !== null && (
                        <p className={`text-xs font-medium ${deviation >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {deviation >= 0 ? '+' : ''}{deviation}%
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* ─── Linked Properties: Owner ───────────────────────────────── */}
        {propertiesOwned.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="bg-white rounded-xl border border-slate-200 p-6"
          >
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Owned Properties</h3>
            <div className="space-y-2">
              {propertiesOwned.map((p) => {
                const eager = p.isEager;
                let eagernessLabel = '--';
                if (eager !== undefined && eager !== null) {
                  const val = typeof eager === 'number' && eager >= 70 ? 0 : Number(eager);
                  eagernessLabel = val <= 0.5 ? 'Very Serious' : val <= 1.5 ? 'Serious' : 'Testing';
                }
                return (
                  <div key={p.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{p.formattedAddress || p.address || p.id}</p>
                      <p className="text-xs text-slate-500">Price: {formatPrice(p.price)}</p>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <p className="text-sm text-slate-600">{eagernessLabel}</p>
                      <p className="text-xs text-slate-400">{p.active === false ? 'Inactive' : 'Active'}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* ─── Preferences ────────────────────────────────────────────── */}
        {contact.buyerPreferences && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-xl border border-slate-200 p-6"
          >
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Buyer Preferences</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {contact.buyerPreferences.locations && (
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-slate-400 mt-0.5" />
                  <div>
                    <p className="text-xs text-slate-500">Locations</p>
                    <p className="text-slate-700">{Array.isArray(contact.buyerPreferences.locations) ? contact.buyerPreferences.locations.join(', ') : contact.buyerPreferences.locations}</p>
                  </div>
                </div>
              )}
              {contact.buyerPreferences.propertyType && (
                <div className="flex items-start gap-2">
                  <Home className="w-4 h-4 text-slate-400 mt-0.5" />
                  <div>
                    <p className="text-xs text-slate-500">Property Type</p>
                    <p className="text-slate-700">{contact.buyerPreferences.propertyType}</p>
                  </div>
                </div>
              )}
              {contact.buyerPreferences.bedrooms && (
                <div className="flex items-start gap-2">
                  <Bed className="w-4 h-4 text-slate-400 mt-0.5" />
                  <div>
                    <p className="text-xs text-slate-500">Bedrooms</p>
                    <p className="text-slate-700">{contact.buyerPreferences.bedrooms}</p>
                  </div>
                </div>
              )}
              {(contact.buyerPreferences.budgetMin || contact.buyerPreferences.budgetMax) && (
                <div className="flex items-start gap-2">
                  <DollarSign className="w-4 h-4 text-slate-400 mt-0.5" />
                  <div>
                    <p className="text-xs text-slate-500">Budget</p>
                    <p className="text-slate-700">
                      {formatPrice(contact.buyerPreferences.budgetMin)} – {formatPrice(contact.buyerPreferences.budgetMax)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ScoreCard({ label, value }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl border border-slate-200 p-4"
    >
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${scoreColor(value)}`}>{value}</p>
      <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${scoreBarColor(value)}`} style={{ width: `${value}%` }} />
      </div>
    </motion.div>
  );
}

function StatCard({ label, value }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl border border-slate-200 p-4"
    >
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
    </motion.div>
  );
}

function Factor({ label, value, pct, weight }) {
  return (
    <div className="bg-slate-50 rounded-lg p-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-600">{label}</span>
        <span className="text-xs text-slate-400">{weight}</span>
      </div>
      <div className="text-sm font-medium text-slate-900">{value}</div>
      <div className="mt-1 h-1 bg-slate-200 rounded-full overflow-hidden">
        <div className="h-full bg-slate-400 rounded-full" style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}
