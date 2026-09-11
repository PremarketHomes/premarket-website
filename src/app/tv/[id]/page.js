'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { db } from '../../firebase/clientApp';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  collection,
  query,
  where,
  addDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Play,
  X,
  BedDouble,
  Bath,
  Car,
  Grid2X2,
} from 'lucide-react';
import PriceOpinionSlider, { roundToStep } from '../../components/PriceOpinionSlider';

/* ─────────── helpers ─────────── */

const formatMoney = (val) => {
  if (!val) return '$0';
  return `$${Math.round(val).toLocaleString()}`;
};

const formatCompact = (val) => {
  if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
  if (val >= 1000) return `$${(val / 1000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
};

const computeInitialRange = (data) => {
  const toDouble = (v) => {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return parseFloat(v.replace(/[^\d.]/g, '')) || 0;
    return 0;
  };

  let basePrice = toDouble(data.price);
  if (basePrice === 0) {
    const pe = data.propertyJob?.price_estimate;
    if (pe) basePrice = toDouble(pe.mid) || toDouble(pe.high) || toDouble(pe.low);
  }
  if (basePrice === 0) basePrice = toDouble(data.priceGuide);
  if (basePrice === 0) basePrice = 1000000;

  return {
    min: roundToStep(basePrice * 0.75),
    max: roundToStep(basePrice * 1.25),
  };
};

/** Get all image URLs from a property (handles imageUrls array field) */
const getPropertyImages = (p) => {
  if (!p) return [];
  return (p.imageUrls || []).filter(Boolean);
};

/* ─────────── component ─────────── */

export default function TvDisplayPageWrapper() {
  return (
    <Suspense fallback={
      <div className="h-dvh bg-[#1a1a1a] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-orange-500" />
      </div>
    }>
      <TvDisplayPage />
    </Suspense>
  );
}

function TvDisplayPage() {
  const { id: displayId } = useParams();
  const searchParams = useSearchParams();
  const [isPreview, setIsPreview] = useState(false);

  useEffect(() => {
    setIsPreview(searchParams.get('preview') === 'true');
  }, [searchParams]);

  /* data */
  const [displayConfig, setDisplayConfig] = useState(null);
  const [properties, setProperties] = useState([]);
  const [agents, setAgents] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* navigation */
  const [currentPropertyIndex, setCurrentPropertyIndex] = useState(0);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  /* timers */
  const autoRotateRef = useRef(null);
  const idleRef = useRef(null);

  /* price slider */
  const [priceOpinion, setPriceOpinion] = useState(0);
  const [minPrice, setMinPrice] = useState(0);
  const [maxPrice, setMaxPrice] = useState(0);
  const [isSliding, setIsSliding] = useState(false);
  const [savedOfferId, setSavedOfferId] = useState(null);

  /* modals */
  const [showQualificationModal, setShowQualificationModal] = useState(false);
  const [qualificationData, setQualificationData] = useState({
    isFirstHomeBuyer: false,
    isInvestor: false,
    buyerType: '',
    seriousnessLevel: '',
  });
  const [showThankYou, setShowThankYou] = useState(false);
  const [showViewAll, setShowViewAll] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [showSignupModal, setShowSignupModal] = useState(false);

  /* signup form */
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [signupError, setSignupError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /* ═══════ current property shorthand ═══════ */
  const property = properties[currentPropertyIndex] || null;
  const imageUrls = getPropertyImages(property);
  const agent = property ? agents[property.userId] : null;
  const videoUrl = property?.aiVideo?.url || property?.videoUrl || null;

  /* ═══════ fetch display + properties + agents ═══════ */
  useEffect(() => {
    if (!displayId) return;

    async function load() {
      try {
        const snap = await getDoc(doc(db, 'displays', displayId));
        if (!snap.exists()) {
          setError('Display not found');
          setLoading(false);
          return;
        }
        const config = { id: snap.id, ...snap.data() };
        setDisplayConfig(config);

        if (config.agentIds?.length) {
          const chunks = [];
          for (let i = 0; i < config.agentIds.length; i += 30) {
            chunks.push(config.agentIds.slice(i, i + 30));
          }
          const allDocs = [];
          for (const chunk of chunks) {
            const q = query(
              collection(db, 'properties'),
              where('userId', 'in', chunk),
              where('active', '==', true),
              where('visibility', '==', true)
            );
            const s = await getDocs(q);
            s.docs.forEach((d) => allDocs.push({ id: d.id, ...d.data() }));
          }
          allDocs.sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
            const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
            return bTime - aTime;
          });
          setProperties(allDocs);
        } else {
          const propsQuery = query(
            collection(db, 'properties'),
            where('active', '==', true),
            where('visibility', '==', true)
          );
          const propsSnap = await getDocs(propsQuery);
          const allProps = propsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          allProps.sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
            const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
            return bTime - aTime;
          });
          setProperties(allProps);
        }
      } catch (err) {
        console.error('TV display load error:', err);
        setError('Failed to load display');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [displayId]);

  /* fetch agent data for each unique userId */
  useEffect(() => {
    if (!properties.length) return;
    const userIds = [...new Set(properties.map((p) => p.userId).filter(Boolean))];
    const missing = userIds.filter((uid) => !agents[uid]);
    if (!missing.length) return;

    Promise.all(
      missing.map(async (uid) => {
        try {
          const snap = await getDoc(doc(db, 'users', uid));
          if (snap.exists()) {
            const d = snap.data();
            return [uid, { firstName: d.firstName, lastName: d.lastName, companyName: d.companyName, avatar: d.avatar, logoUrl: d.logoUrl }];
          }
        } catch {}
        return null;
      })
    ).then((results) => {
      const next = { ...agents };
      results.filter(Boolean).forEach(([uid, data]) => { next[uid] = data; });
      setAgents(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties]);

  /* preload images */
  useEffect(() => {
    properties.forEach((p) => {
      getPropertyImages(p).forEach((url) => {
        const img = new window.Image();
        img.src = url;
      });
    });
  }, [properties]);

  /* ═══════ price range on property change ═══════ */
  useEffect(() => {
    if (!property) return;
    const { min, max } = computeInitialRange(property);
    setMinPrice(min);
    setMaxPrice(max);
    setPriceOpinion(roundToStep((min + max) / 2));
    setCurrentImageIndex(0);
    setSavedOfferId(null);
  }, [currentPropertyIndex, property?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ═══════ auto-rotation ═══════ */
  const modalOpen = showQualificationModal || showSignupModal || showThankYou;

  const startAutoRotate = useCallback(() => {
    clearInterval(autoRotateRef.current);
    if (properties.length <= 1) return;
    autoRotateRef.current = setInterval(() => {
      setCurrentPropertyIndex((i) => (i + 1) % properties.length);
    }, 30000);
  }, [properties.length]);

  const pauseAutoRotate = useCallback(() => {
    clearInterval(autoRotateRef.current);
    clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => startAutoRotate(), 30000);
  }, [startAutoRotate]);

  /* Pause carousel while any modal is open */
  useEffect(() => {
    if (modalOpen) {
      clearInterval(autoRotateRef.current);
      clearTimeout(idleRef.current);
    } else {
      startAutoRotate();
    }
  }, [modalOpen, startAutoRotate]);

  useEffect(() => {
    startAutoRotate();
    return () => {
      clearInterval(autoRotateRef.current);
      clearTimeout(idleRef.current);
    };
  }, [startAutoRotate]);

  useEffect(() => {
    const handler = () => pauseAutoRotate();
    window.addEventListener('touchstart', handler, { passive: true });
    window.addEventListener('mousedown', handler);
    return () => {
      window.removeEventListener('touchstart', handler);
      window.removeEventListener('mousedown', handler);
    };
  }, [pauseAutoRotate]);

  /* ═══════ reset interaction ═══════ */
  const resetTvInteraction = useCallback(() => {
    setSavedOfferId(null);
    setShowQualificationModal(false);
    setShowSignupModal(false);
    setShowThankYou(false);
    setQualificationData({ isFirstHomeBuyer: false, isInvestor: false, buyerType: '', seriousnessLevel: '' });
    setEmail('');
    setFirstName('');
    setLastName('');
    setPassword('');
    setSignupError('');
    if (property) {
      const mid = roundToStep((minPrice + maxPrice) / 2);
      setPriceOpinion(mid);
    }
  }, [property, minPrice, maxPrice]);

  /* ═══════ save offer ═══════ */
  const saveTvPriceOpinion = () => {
    setShowQualificationModal(true);

    const sessionId = `tv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const offerData = {
      type: 'opinion',
      propertyId: property.id,
      sessionId,
      offerAmount: Math.round(priceOpinion),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      fromWeb: true,
      fromTvDisplay: true,
      displayId,
    };

    addDoc(collection(db, 'offers'), offerData)
      .then((ref) => setSavedOfferId(ref.id))
      .catch((err) => console.error('Error saving TV offer:', err));
  };

  const handleQualificationSubmit = () => {
    if (!qualificationData.buyerType || !qualificationData.seriousnessLevel) return;
    setShowQualificationModal(false);
    setShowSignupModal(true);

    // Save qualification data to offer in background
    if (savedOfferId) {
      updateDoc(doc(db, 'offers', savedOfferId), {
        serious: true,
        isFirstHomeBuyer: qualificationData.isFirstHomeBuyer,
        isInvestor: qualificationData.isInvestor,
        buyerType: qualificationData.buyerType,
        seriousnessLevel: qualificationData.seriousnessLevel,
        updatedAt: serverTimestamp(),
      }).catch((err) => console.error('Error updating TV offer:', err));
    }
  };

  const handleSkipQualification = () => {
    setShowQualificationModal(false);
    setShowSignupModal(true);
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setSignupError('');
    setSubmitting(true);

    try {
      const auth = getAuth();
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email.trim().toLowerCase(),
        password
      );
      const userId = userCredential.user.uid;

      await setDoc(doc(db, 'users', userId), {
        uid: userId,
        email: email.trim().toLowerCase(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: '',
        pro: false,
        agent: false,
        buyer: true,
        created: serverTimestamp(),
        tags: ['new', 'buyer'],
        avatar: 'https://premarketvideos.b-cdn.net/assets/icon.png',
        activeCampaigns: 0,
        availableCampaigns: 1,
      });

      // Link user to the saved offer
      if (savedOfferId) {
        await updateDoc(doc(db, 'offers', savedOfferId), {
          userId,
          serious: true,
          isFirstHomeBuyer: qualificationData.isFirstHomeBuyer,
          isInvestor: qualificationData.isInvestor,
          buyerType: qualificationData.buyerType,
          seriousnessLevel: qualificationData.seriousnessLevel,
          updatedAt: serverTimestamp(),
        });
      }

      setShowSignupModal(false);
      setShowThankYou(true);
      setTimeout(() => {
        setShowThankYou(false);
        resetTvInteraction();
      }, 4000);
    } catch (error) {
      console.error('TV signup error:', error);
      if (error.code === 'auth/email-already-in-use') {
        setSignupError('This email already has an account. Your opinion has been saved.');
        // Still show thank you after a moment since the opinion is saved
        setTimeout(() => {
          setShowSignupModal(false);
          setShowThankYou(true);
          setTimeout(() => {
            setShowThankYou(false);
            resetTvInteraction();
          }, 3000);
        }, 2000);
      } else {
        setSignupError(error.message || 'Failed to create account');
      }
    } finally {
      setSubmitting(false);
    }
  };

  /* ═══════ loading / error ═══════ */
  if (loading) {
    return (
      <div className="h-dvh bg-[#1a1a1a] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-orange-500" />
      </div>
    );
  }

  if (error || !displayConfig) {
    return (
      <div className="h-dvh bg-[#1a1a1a] flex items-center justify-center text-white">
        <div className="text-center">
          <p className="text-2xl font-bold mb-2">Display Error</p>
          <p className="text-neutral-400">{error || 'Configuration not found'}</p>
        </div>
      </div>
    );
  }

  if (!properties.length) {
    return (
      <div className="h-dvh bg-[#1a1a1a] flex items-center justify-center text-white">
        <div className="text-center">
          <p className="text-2xl font-bold mb-2">No Properties</p>
          <p className="text-neutral-400">No active properties to display</p>
        </div>
      </div>
    );
  }

  const specs = [
    property.bedrooms && { icon: BedDouble, val: property.bedrooms },
    property.bathrooms && { icon: Bath, val: property.bathrooms },
    property.carSpaces && { icon: Car, val: property.carSpaces },
  ].filter(Boolean);

  /* ═══════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════ */

  const goToPrevProperty = () => {
    setCurrentPropertyIndex((i) => (i - 1 + properties.length) % properties.length);
    pauseAutoRotate();
  };
  const goToNextProperty = () => {
    setCurrentPropertyIndex((i) => (i + 1) % properties.length);
    pauseAutoRotate();
  };

  const screenContent = (
    <>
      {/* ════════ A. Agent Header ════════ */}
      <div className="flex-shrink-0 bg-white px-4 py-2.5 border-b border-slate-100">
        <AnimatePresence mode="wait">
          <motion.div
            key={property.userId}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="flex items-center gap-2.5"
          >
            {agent ? (
              <>
                <div className="flex-shrink-0">
                  {agent.avatar ? (
                    <img
                      src={agent.avatar}
                      alt={agent.firstName || 'Agent'}
                      className="rounded-lg object-cover w-9 h-9"
                    />
                  ) : (
                    <div className="w-9 h-9 bg-gradient-to-br from-orange-400 to-amber-500 rounded-lg flex items-center justify-center text-white font-bold text-sm">
                      {(agent.firstName?.[0] || '?').toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 text-xs truncate leading-tight">
                    {agent.firstName} {agent.lastName}
                  </p>
                  {agent.companyName && (
                    <p className="text-[10px] text-slate-500 truncate leading-tight">{agent.companyName}</p>
                  )}
                </div>
                {agent.logoUrl && (
                  <div className="flex-shrink-0 ml-auto">
                    <img src={agent.logoUrl} alt="" className="h-8 w-auto max-w-[80px] object-contain" />
                  </div>
                )}
              </>
            ) : (
              <div className="h-9" />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ════════ B. Price Slider ════════ */}
      <div className="flex-shrink-0 bg-slate-800 px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-white font-bold uppercase tracking-wide">What would you pay?</p>
          <motion.p
            key={priceOpinion}
            initial={{ scale: 1.08 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.15 }}
            className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-[#e48900] to-[#c64500]"
          >
            {formatMoney(priceOpinion)}
          </motion.p>
        </div>
        <div className="pt-6 pb-8">
          <PriceOpinionSlider
            min={minPrice}
            max={maxPrice}
            value={priceOpinion}
            onChange={setPriceOpinion}
            onSlideStart={() => setIsSliding(true)}
            onSlideEnd={() => { setIsSliding(false); saveTvPriceOpinion(); }}
            className="w-full cursor-pointer tv-slider"
          />
        </div>
        <div className="flex justify-between text-[11px] font-semibold">
          <span className="text-slate-400">{formatCompact(minPrice)}</span>
          <span className="text-slate-500 text-[10px]">Drag & release to register interest</span>
          <span className="text-slate-400">{formatCompact(maxPrice)}</span>
        </div>
      </div>

      {/* ════════ C. Hero Image ════════ */}
      <div className="flex-shrink-0 relative bg-slate-900" style={{ height: '36%' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={`${property.id}-${currentImageIndex}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0"
          >
            {imageUrls[currentImageIndex] ? (
              <img
                src={imageUrls[currentImageIndex]}
                alt={property.title || property.address || ''}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-slate-800 flex items-center justify-center text-slate-500 text-sm">
                No Image
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Video button */}
        {videoUrl && (
          <button
            onClick={() => setShowVideo(true)}
            className="absolute top-3 right-3 z-10 px-3 py-1.5 bg-black/60 backdrop-blur-sm text-white text-xs font-semibold rounded-full flex items-center gap-1.5"
          >
            <Play className="w-3 h-3" fill="white" />
            Video
          </button>
        )}

        {/* Gallery arrows */}
        {imageUrls.length > 1 && (
          <>
            <button
              onClick={() => setCurrentImageIndex((i) => (i - 1 + imageUrls.length) % imageUrls.length)}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-12 h-12 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center text-white active:bg-black/70 transition-colors"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={() => setCurrentImageIndex((i) => (i + 1) % imageUrls.length)}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-12 h-12 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center text-white active:bg-black/70 transition-colors"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}

        {/* Dots */}
        {imageUrls.length > 1 && (
          <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 z-10 flex gap-1.5">
            {imageUrls.slice(0, 8).map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentImageIndex(i)}
                className={`h-2 rounded-full transition-all ${
                  i === currentImageIndex ? 'bg-white w-4' : 'bg-white/50 w-2'
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* ════════ D. Property Info ════════ */}
      <div className="flex-1 min-h-0 flex flex-col px-4 py-3">
        {/* Title */}
        <h1 className="text-lg font-bold text-slate-900 leading-tight flex-shrink-0">{property.title || property.address}</h1>

        {/* Address */}
        {property.address && property.title && (
          <p className="text-[11px] text-slate-500 mt-0.5 truncate flex-shrink-0">
            {property.showSuburbOnly
              ? property.address?.split(',')[1]?.trim() || property.location?.suburb || ''
              : property.address}
          </p>
        )}

        {/* Specs */}
        {specs.length > 0 && (
          <div className="flex items-center gap-3 mt-2 flex-shrink-0">
            {specs.map(({ icon: Icon, val }, i) => (
              <div key={i} className="flex items-center gap-1 text-slate-600">
                <Icon className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold">{val}</span>
              </div>
            ))}
          </div>
        )}

        {/* Description — always expanded, scrollable */}
        {property.description && (
          <div className="mt-2 flex-1 min-h-0 overflow-y-auto scrollbar-hide">
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {property.description}
            </p>
          </div>
        )}
      </div>

      {/* ════════ E. Property Navigation + View All ════════ */}
      {properties.length > 1 && (
        <div className="flex-shrink-0 border-t border-slate-100">
          <div className="flex items-center gap-2 px-3 py-2">
            <button
              onClick={goToPrevProperty}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-bold rounded-xl active:opacity-80 transition-opacity shadow-md text-sm"
            >
              <ChevronLeft className="w-5 h-5" />
              Prev
            </button>
            <button
              onClick={() => setShowViewAll(true)}
              className="flex items-center justify-center gap-1.5 px-3 py-3 bg-slate-100 rounded-xl active:bg-slate-200 transition-colors"
            >
              <Grid2X2 className="w-4 h-4 text-slate-600" />
              <span className="text-xs font-bold text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded-full">
                {properties.length}
              </span>
            </button>
            <button
              onClick={goToNextProperty}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-bold rounded-xl active:opacity-80 transition-opacity shadow-md text-sm"
            >
              Next
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* ════════ G. Footer ════════ */}
      <div className="flex-shrink-0 bg-white border-t border-slate-100 py-1.5 flex items-center justify-center gap-1.5">
        <span className="text-[8px] text-slate-400 font-medium uppercase tracking-wider">Powered by</span>
        <Image
          src="https://premarketvideos.b-cdn.net/assets/logo.png"
          alt="Premarket"
          width={70}
          height={17}
          className="opacity-40"
          unoptimized
        />
      </div>

      {/* ════════ View All Panel (inside screen) ════════ */}
      <AnimatePresence>
        {showViewAll && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="absolute inset-0 bg-white z-20 flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 flex-shrink-0">
              <h2 className="text-sm font-bold text-slate-900">All Properties ({properties.length})</h2>
              <button
                onClick={() => setShowViewAll(false)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-slate-600" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 scrollbar-hide">
              <div className="grid grid-cols-2 gap-2">
                {properties.map((p, i) => {
                  const imgs = getPropertyImages(p);
                  const thumb = imgs[0];
                  return (
                    <button
                      key={p.id}
                      onClick={() => {
                        setCurrentPropertyIndex(i);
                        setShowViewAll(false);
                      }}
                      className={`rounded-lg overflow-hidden border-2 text-left transition-all ${
                        i === currentPropertyIndex ? 'border-orange-500' : 'border-slate-200'
                      }`}
                    >
                      <div className="aspect-[4/3] bg-slate-200 relative">
                        {thumb ? (
                          <img src={thumb} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-400 text-[10px]">
                            No image
                          </div>
                        )}
                      </div>
                      <div className="px-1.5 py-1">
                        <p className="text-[10px] font-semibold text-slate-900 truncate">{p.title || p.address || 'Property'}</p>
                        {p.price && <p className="text-[10px] font-bold text-orange-600">{typeof p.price === 'number' ? formatMoney(p.price) : p.price}</p>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  return (
    <div className="h-dvh w-full bg-[#111] flex flex-col items-center justify-start overflow-hidden select-none">

      {isPreview ? (
        /* ═══════ PREVIEW MODE — Mock kiosk frame ═══════ */
        <div className="relative flex flex-col items-center h-full w-full max-w-[56.25dvh]">
          {/* ── Display bezel ── */}
          <div className="relative flex-1 w-full min-h-0" style={{ margin: '0.8% 0 0 0' }}>
            <div className="absolute inset-0 rounded-[2rem] bg-gradient-to-b from-[#2a2a2a] via-[#1a1a1a] to-[#0d0d0d] shadow-[0_0_60px_rgba(0,0,0,0.8)]" />
            <div className="absolute inset-[3px] rounded-[1.85rem] bg-gradient-to-b from-[#333] via-[#181818] to-[#111]" />
            <div className="absolute rounded-[1.5rem] overflow-hidden bg-slate-50 flex flex-col"
                 style={{ top: '2.5%', left: '3.5%', right: '3.5%', bottom: '2.5%' }}>
              {screenContent}
            </div>
            <div className="absolute bottom-[1.2%] left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]" />
          </div>
          {/* ── Stand / Pedestal ── */}
          <div className="flex-shrink-0 flex flex-col items-center" style={{ height: '12%' }}>
            <div className="w-[8%] flex-1 bg-gradient-to-b from-[#222] via-[#1a1a1a] to-[#252525] rounded-b-sm" />
            <div className="w-[35%] h-[30%] bg-gradient-to-b from-[#2a2a2a] to-[#1f1f1f] rounded-t-lg rounded-b-[50%] shadow-[0_4px_20px_rgba(0,0,0,0.5)]" />
            <div className="w-[50%] h-[8%] bg-black/30 rounded-[50%] blur-sm mt-0.5" />
          </div>
        </div>
      ) : (
        /* ═══════ LIVE MODE — Fullscreen ═══════ */
        <div className="relative h-full w-full bg-slate-50 flex flex-col overflow-hidden">
          {screenContent}
        </div>
      )}

      {/* ════════ Qualification Modal ════════ */}
      <AnimatePresence>
        {showQualificationModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 relative max-h-[85vh] overflow-y-auto"
            >
              <button
                onClick={() => { setShowQualificationModal(false); resetTvInteraction(); }}
                className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="text-center mb-5">
                <div className="w-14 h-14 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-7 h-7 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-1">
                  Opinion: {formatMoney(priceOpinion)}
                </h3>
                <p className="text-slate-500 text-sm">Tell us a bit about yourself (optional)</p>
              </div>

              <div className="space-y-4">
                {/* First Home Buyer */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm font-semibold text-slate-800">First home buyer?</span>
                    <input
                      type="checkbox"
                      checked={qualificationData.isFirstHomeBuyer}
                      onChange={(e) => setQualificationData({ ...qualificationData, isFirstHomeBuyer: e.target.checked })}
                      className="w-6 h-6 text-orange-600 rounded focus:ring-2 focus:ring-orange-500"
                    />
                  </label>
                </div>

                {/* Investor */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm font-semibold text-slate-800">Are you an investor?</span>
                    <input
                      type="checkbox"
                      checked={qualificationData.isInvestor}
                      onChange={(e) => setQualificationData({ ...qualificationData, isInvestor: e.target.checked })}
                      className="w-6 h-6 text-orange-600 rounded focus:ring-2 focus:ring-orange-500"
                    />
                  </label>
                </div>

                {/* Finance status */}
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">Finance status</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'cash', label: 'Cash Buyer' },
                      { value: 'approved_finance', label: 'Approved Finance' },
                      { value: 'pre_approval', label: 'Pre-Approval' },
                      { value: 'not_yet', label: 'Not Yet' },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setQualificationData({ ...qualificationData, buyerType: option.value })}
                        className={`px-3 py-2.5 rounded-lg border-2 text-sm font-semibold transition-all ${
                          qualificationData.buyerType === option.value
                            ? 'border-orange-600 bg-orange-50 text-orange-600'
                            : 'border-slate-200 bg-white text-slate-700 active:border-slate-300'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Interest level */}
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">Interest level</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'just_browsing', label: 'Just Browsing' },
                      { value: 'interested', label: 'Interested' },
                      { value: 'very_interested', label: 'Very Interested' },
                      { value: 'ready_to_buy', label: 'Ready to Buy' },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setQualificationData({ ...qualificationData, seriousnessLevel: option.value })}
                        className={`px-3 py-2.5 rounded-lg border-2 text-sm font-semibold transition-all ${
                          qualificationData.seriousnessLevel === option.value
                            ? 'border-orange-600 bg-orange-50 text-orange-600'
                            : 'border-slate-200 bg-white text-slate-700 active:border-slate-300'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Submit */}
                <button
                  onClick={handleQualificationSubmit}
                  disabled={!qualificationData.buyerType || !qualificationData.seriousnessLevel}
                  className="w-full bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-bold py-3.5 rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Submit
                </button>

                {/* Skip */}
                <button
                  onClick={handleSkipQualification}
                  className="w-full py-2 text-slate-500 font-medium text-sm"
                >
                  Skip — just submit my price opinion
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ════════ Signup Modal ════════ */}
      <AnimatePresence>
        {showSignupModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 relative max-h-[85vh] overflow-y-auto"
            >
              <button
                onClick={() => { setShowSignupModal(false); resetTvInteraction(); }}
                className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="text-center mb-5">
                <div className="w-14 h-14 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-7 h-7 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-1">Create Your Account</h3>
                <p className="text-slate-500 text-sm">Get notified when this property goes to market</p>
              </div>

              <form onSubmit={handleSignup} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">First Name</label>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                      className="text-slate-900 placeholder-slate-300 w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none text-sm"
                      placeholder="John"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Last Name</label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required
                      className="text-slate-900 placeholder-slate-300 w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none text-sm"
                      placeholder="Doe"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="text-slate-900 placeholder-slate-300 w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none text-sm"
                    placeholder="john@example.com"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="text-slate-900 placeholder-slate-300 w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none text-sm"
                    placeholder="Min 6 characters"
                  />
                </div>

                {signupError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs">
                    {signupError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-bold py-3 rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {submitting ? 'Creating Account...' : 'Create Account & Get Notified'}
                </button>
              </form>

              <button
                onClick={() => {
                  setShowSignupModal(false);
                  setShowThankYou(true);
                  setTimeout(() => {
                    setShowThankYou(false);
                    resetTvInteraction();
                  }, 3000);
                }}
                className="w-full mt-2 py-2 text-slate-500 font-medium text-xs text-center"
              >
                Skip — just submit my price opinion
              </button>

              <p className="text-[10px] text-center text-slate-400 mt-3">
                By creating an account, you agree to our Terms of Service and Privacy Policy
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ════════ Thank You Overlay ════════ */}
      <AnimatePresence>
        {showThankYou && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white/90 backdrop-blur-sm flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-center"
            >
              <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-5">
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Thank You!</h2>
              <p className="text-slate-500">Your interest has been registered</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>


      {/* ════════ Video Modal ════════ */}
      <AnimatePresence>
        {showVideo && videoUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black z-50 flex items-center justify-center"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setShowVideo(false); }}
          >
            <button
              onClick={() => setShowVideo(false)}
              className="absolute top-4 right-4 z-10 p-2 bg-white/20 rounded-full text-white"
            >
              <X className="w-6 h-6" />
            </button>
            <video
              src={videoUrl}
              controls
              autoPlay
              className="max-w-full max-h-full"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ════════ Custom CSS ════════ */}
      <style dangerouslySetInnerHTML={{ __html: `
        .tv-slider {
          -webkit-appearance: none !important;
          appearance: none !important;
          background: transparent !important;
          height: 20px !important;
        }
        .tv-slider::-webkit-slider-runnable-track {
          height: 20px !important;
          border-radius: 9999px !important;
          background: linear-gradient(to right, #fb923c, #facc15, #22c55e) !important;
        }
        .tv-slider::-webkit-slider-thumb {
          -webkit-appearance: none !important;
          appearance: none !important;
          width: 72px !important;
          height: 72px !important;
          border-radius: 50% !important;
          background: white !important;
          cursor: pointer !important;
          box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3) !important;
          border: 6px solid #ea580c !important;
          margin-top: -26px !important;
        }
        .tv-slider::-moz-range-track {
          height: 20px !important;
          border-radius: 9999px !important;
          background: linear-gradient(to right, #fb923c, #facc15, #22c55e) !important;
          border: none !important;
        }
        .tv-slider::-moz-range-thumb {
          width: 72px !important;
          height: 72px !important;
          border-radius: 50% !important;
          background: white !important;
          cursor: pointer !important;
          box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3) !important;
          border: 6px solid #ea580c !important;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}} />
    </div>
  );
}
