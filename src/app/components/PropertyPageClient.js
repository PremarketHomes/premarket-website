'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { getAuth } from 'firebase/auth';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase/clientApp';
import { doc, getDoc, addDoc, collection, serverTimestamp, updateDoc } from 'firebase/firestore';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { usePropertyEngagement } from '../hooks/usePropertyEngagement';
import PriceOpinionSlider, { roundToStep } from './PriceOpinionSlider';
import { computeBrandStyle, computeDisplayLogoUrl } from '../utils/brandStyle';
import { getMarketStatusCopy } from '../utils/marketStatusCopy';
import { isPreviewDeployment } from '../utils/previewEnvironment';
import { getSwipeDirection } from '../utils/swipeGesture';
import PreviewModeBanner from './property-page/PreviewModeBanner';
import { playfairDisplay } from './property-page/fonts';
import PropertyHeader from './property-page/PropertyHeader';
import PropertyHero from './property-page/PropertyHero';
import PriceOpinionCard from './property-page/PriceOpinionCard';
import PropertyInfoCard from './property-page/PropertyInfoCard';
import PropertyGallery from './property-page/PropertyGallery';
import AgentSignOff from './property-page/AgentSignOff';

// Generate a session ID for tracking price opinions
const getSessionId = () => {
  if (typeof window === 'undefined') return null;
  
  let sessionId = sessionStorage.getItem('premarketSessionId');
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    sessionStorage.setItem('premarketSessionId', sessionId);
  }
  return sessionId;
};

export default function PropertyPageClient({ previewBrand, previewPropertyId } = {}) {
  const searchParams = useSearchParams();
  const propertyId = previewPropertyId || searchParams.get('propertyId');
  const initialMode = searchParams.get('mode');
  const auth = getAuth();
  const { user: currentAuthUser } = useAuth();

  const [isIpadMode, setIsIpadMode] = useState(initialMode === 'ipad');
  const [ipadThankYou, setIpadThankYou] = useState(false);

  const [showQualificationModal, setShowQualificationModal] = useState(false);
  const [qualificationData, setQualificationData] = useState({
    isFirstHomeBuyer: false,
    isInvestor: false,
    buyerType: '',
    seriousnessLevel: '',
  });

  const [property, setProperty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videoPlaybackError, setVideoPlaybackError] = useState(false);
  
  // Price opinion state
  const [priceOpinion, setPriceOpinion] = useState(0);
  const [minPrice, setMinPrice] = useState(0);
  const [maxPrice, setMaxPrice] = useState(0);
  const [showPriceOpinionModal, setShowPriceOpinionModal] = useState(false);
  const [showConfirmOpinionModal, setShowConfirmOpinionModal] = useState(false);
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [registerInterest, setRegisterInterest] = useState(false);
  const [savedOfferId, setSavedOfferId] = useState(null);
  const [isSliding, setIsSliding] = useState(false);
  const [ipadContactStep, setIpadContactStep] = useState(false);
  const [phone, setPhone] = useState('');

  // Signup form state
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [signupError, setSignupError] = useState('');
  const [showThankYou, setShowThankYou] = useState(false);

  // Buyer preferences state

  // Agent data state
  const [agentData, setAgentData] = useState(null);
  // Agency branding (optional — null for the ~all existing agents who
  // haven't opted in, in which case every colour below falls back to the
  // existing default Premarket theme via the CSS var(--x, <default>)
  // fallbacks already baked into the JSX/CSS below. Nothing here changes
  // price opinions, views, registrations, or any other product logic —
  // this is presentation only.
  const [brand, setBrand] = useState(null);

  // Sticky price bar visibility
  const [showStickyPrice, setShowStickyPrice] = useState(false);

  // Engagement tracking (view duration, scroll depth, photos, shares, opinions)
  const {
    trackPhotoView,
    trackShare,
    trackOpinionStart,
    trackOpinionComplete,
  } = usePropertyEngagement(propertyId);

  const trackEvent = (eventName, eventParams = {}) => {
    if (typeof window !== 'undefined' && window.dataLayer) {
      window.dataLayer.push({
        event: eventName,
        ...eventParams
      });
    }
  };

  // Track page view when component mounts
  useEffect(() => {
    if (property) {
      trackEvent('property_view', {
        property_id: propertyId,
        property_title: property.title,
        property_address: property.address,
        property_price: property.price,
        page_path: window.location.pathname
      });
    }
  }, [property, propertyId]);

  // Ask the user to confirm their opinion when the slider is released
  useEffect(() => {
    if (!isSliding && priceOpinion > 0 && propertyId) {
      setShowConfirmOpinionModal(true);
    }
  }, [isSliding]);

  const confirmPriceOpinion = () => {
    setShowConfirmOpinionModal(false);
    if (isIpadMode) {
      saveIpadPriceOpinion();
    } else {
      savePriceOpinion();
    }
  };
  
  useEffect(() => {
    if (!propertyId) return;
    const fetchProperty = async () => {
      try {
        const docRef = doc(db, 'properties', propertyId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = { id: docSnap.id, ...docSnap.data() };
          setProperty(data);
          
          // Calculate price range based on property.price
          const { min, max } = computeInitialRange(data);
          setMinPrice(min);
          setMaxPrice(max);
          
          // Fetch previous offer to set initial slider value
          await fetchPreviousOffer(propertyId, min, max);

          // Increment the view count (skip if owner/admin is viewing)
          const currentUser = auth.currentUser;
          if (!currentUser || currentUser.uid !== data.userId) {
            await incrementPropertyViews(propertyId);
          }
        }
      } catch (err) {
        console.error('Error fetching property:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchProperty();
  }, [propertyId]);

  // Fetch agent data for this property
  useEffect(() => {
    if (!property?.userId) return;

    // Clear any previously-loaded brand before fetching this property's
    // agent — without this, switching propertyId (e.g. the dashboard
    // preview swapping properties, or in-app navigation between two
    // property pages without a full remount) could briefly, or
    // permanently if the new agent has no brand, keep showing the
    // previous agent's branded colours/logo on the new property.
    setBrand(null);

    const fetchAgentData = async () => {
      try {
        const userDoc = await getDoc(doc(db, 'users', property.userId));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          const data = {
            firstName: userData.firstName,
            lastName: userData.lastName,
            companyName: userData.companyName,
            avatar: userData.avatar,
            logoUrl: userData.logoUrl,
            phone: userData.phone,
          };

          // If property has an assigned agent, override name/avatar
          if (property.agentId) {
            // Prefer denormalized fields on the property doc (always available)
            if (property.agentName) {
              data.firstName = property.agentName;
              data.lastName = '';
              if (property.agentAvatar) data.avatar = property.agentAvatar;
            } else {
              // Fallback: fetch from agents collection
              try {
                const agentDoc = await getDoc(doc(db, 'agents', property.agentId));
                if (agentDoc.exists()) {
                  const agentInfo = agentDoc.data();
                  data.firstName = agentInfo.name;
                  data.lastName = '';
                  if (agentInfo.avatar) data.avatar = agentInfo.avatar;
                }
              } catch (err) {
                console.error('Error fetching assigned agent:', err);
              }
            }
          }

          setAgentData(data);

          // Agency branding is entirely optional — if the owning agent
          // hasn't opted in (no agencyBrandId), or the linked brand can't
          // be read for any reason, `brand` simply stays null and every
          // colour on this page falls back to the existing default theme.
          if (userData.agencyBrandId) {
            try {
              const brandDoc = await getDoc(doc(db, 'agencyBrands', userData.agencyBrandId));
              if (brandDoc.exists()) {
                setBrand({ id: brandDoc.id, ...brandDoc.data() });
              }
            } catch (err) {
              console.error('Error fetching agency brand (non-fatal):', err);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching agent data:', error);
      }
    };

    fetchAgentData();
  }, [property?.userId, property?.agentId, property?.agentName, property?.agentAvatar]);

  // Sticky price bar scroll visibility
  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY;
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;

      const showThreshold = 400; // Show after scrolling past hero
      const hideThreshold = documentHeight - windowHeight - 600; // Hide near bottom CTA

      setShowStickyPrice(scrollPosition > showThreshold && scrollPosition < hideThreshold);
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const incrementPropertyViews = async (propId) => {
    // Vercel Preview deployments share the same production Firebase
    // project as premarket.homes (see utils/previewEnvironment.js) — never
    // increment a real property's view count from a preview build.
    if (isPreviewDeployment()) return;
    try {
      // Generate or retrieve persistent visitor ID
      let visitorId = localStorage.getItem('pm_visitor_id');
      if (!visitorId) {
        visitorId = `v_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        localStorage.setItem('pm_visitor_id', visitorId);
      }

      // Check if this visitor has viewed this property before
      const viewKey = `pm_viewed_${propId}`;
      const lastViewStr = localStorage.getItem(viewKey);
      const isReturn = !!lastViewStr;
      localStorage.setItem(viewKey, Date.now().toString());

      // Use server-side API to track view (bypasses security rules)
      // Endpoint intentionally avoids the word "track" — ad blockers / privacy
      // extensions (uBlock, Brave Shields, Safari ITP) silently block requests
      // whose path contains "track", which was causing views to go uncounted.
      await fetch('/api/property-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: propId, visitorId, isReturn }),
      });
    } catch (error) {
      console.error('Error incrementing property views:', error);
    }
  };

  const fetchPreviousOffer = async (propId, min, max) => {
    try {
      const sessionId = getSessionId();

      // Looked up server-side (not a direct Firestore read) — `offers`
      // is no longer publicly readable, since it holds buyer PII once
      // someone registers interest. See
      // docs/security-finding-offers-public-read-pii.md and
      // /api/offers/session-lookup, which returns only an id + amount.
      const res = await fetch('/api/offers/session-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: propId, sessionId }),
      });
      const data = res.ok ? await res.json() : { offerId: null, offerAmount: null };

      if (data.offerId && data.offerAmount) {
        setSavedOfferId(data.offerId);
        const roundedOffer = roundToStep(data.offerAmount);
        setPriceOpinion(roundedOffer);
        return;
      }

      // If no session offer found, use midpoint
      const mid = roundToStep((min + max) / 2);
      setPriceOpinion(mid);
    } catch (error) {
      console.error('Error fetching previous offer:', error);
      // Fallback to midpoint if error
      const mid = roundToStep((min + max) / 2);
      setPriceOpinion(mid);
    }
  };

  const savePriceOpinion = async () => {
    trackOpinionStart();
    // Preview deployments connect to the real production Firestore project
    // (see utils/previewEnvironment.js) — simulate a successful save so the
    // full UX can be tested, without writing a real buyer opinion. Analytics
    // events above/below are intentionally still fired so tracking behaviour
    // itself can be verified in preview too.
    if (isPreviewDeployment()) {
      trackOpinionComplete();
      setShowPriceOpinionModal(true);
      return;
    }
    try {
      const sessionId = getSessionId();

      const offerData = {
        type: 'opinion',
        propertyId: propertyId,
        sessionId: sessionId,
        offerAmount: Math.round(priceOpinion),
        updatedAt: serverTimestamp(),
        fromWeb: true,
      };

      if (savedOfferId) {
        // Update existing offer
        const offerRef = doc(db, 'offers', savedOfferId);
        await updateDoc(offerRef, offerData);
        
        trackEvent('price_opinion_updated', {
          property_id: propertyId,
          opinion_amount: Math.round(priceOpinion),
          session_id: sessionId
        });
      } else {
        // Create new offer
        offerData.createdAt = serverTimestamp();
        const docRef = await addDoc(collection(db, 'offers'), offerData);
        setSavedOfferId(docRef.id);
        
        trackEvent('price_opinion_created', {
          property_id: propertyId,
          opinion_amount: Math.round(priceOpinion),
          session_id: sessionId
        });
      }

      trackOpinionComplete();
      // Show the modal
      setShowPriceOpinionModal(true);
    } catch (error) {
      console.error('Error saving price opinion:', error);
    }
  };

  // iPad mode: always create new opinion, increment view, show register interest
  const saveIpadPriceOpinion = () => {
    // Show modal immediately — don't wait for Firestore
    setRegisterInterest(true);
    setShowQualificationModal(true);

    // Preview deployments share production Firestore — never create a
    // real opinion record from a preview build (see
    // utils/previewEnvironment.js). The modal flow above already runs
    // identically either way.
    if (isPreviewDeployment()) {
      trackEvent('ipad_price_opinion_created', {
        property_id: propertyId,
        opinion_amount: Math.round(priceOpinion),
      });
      return;
    }

    // Save in the background
    const ipadSessionId = `ipad_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const offerData = {
      type: 'opinion',
      propertyId: propertyId,
      sessionId: ipadSessionId,
      offerAmount: Math.round(priceOpinion),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      fromWeb: true,
      fromIpadMode: true,
    };

    addDoc(collection(db, 'offers'), offerData)
      .then((docRef) => {
        setSavedOfferId(docRef.id);
        incrementPropertyViews(propertyId);
        trackEvent('ipad_price_opinion_created', {
          property_id: propertyId,
          opinion_amount: Math.round(priceOpinion),
        });
      })
      .catch((error) => {
        console.error('Error saving iPad price opinion:', error);
      });
  };

  // Reset iPad mode to fresh state for next person
  const resetIpadMode = () => {
    setSavedOfferId(null);
    setShowQualificationModal(false);
    setShowSignupModal(false);
    setShowPriceOpinionModal(false);
    setShowConfirmOpinionModal(false);
    setShowThankYou(false);
    setIpadThankYou(false);
    setRegisterInterest(false);
    setIpadContactStep(false);
    setPhone('');
    setQualificationData({
      isFirstHomeBuyer: false,
      isInvestor: false,
      buyerType: '',
      seriousnessLevel: '',
    });
    setEmail('');
    setFirstName('');
    setLastName('');
    setPassword('');
    setSignupError('');
    // Reset slider to midpoint
    const mid = roundToStep((minPrice + maxPrice) / 2);
    setPriceOpinion(mid);
  };

  const computeInitialRange = (data) => {
    const toDouble = (v) => {
      if (!v) return 0;
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const cleaned = v.replace(/[^\d.]/g, '');
        return parseFloat(cleaned) || 0;
      }
      return 0;
    };

    // Get the base price from property.price
    let basePrice = toDouble(data.price);
    
    // If no price, try other sources
    if (basePrice === 0) {
      const priceEstimate = data.propertyJob?.price_estimate;
      if (priceEstimate) {
        basePrice = toDouble(priceEstimate.mid) || 
                    toDouble(priceEstimate.high) || 
                    toDouble(priceEstimate.low);
      }
    }
    
    if (basePrice === 0) {
      basePrice = toDouble(data.priceGuide);
    }
    
    // Default to 1M if still no price
    if (basePrice === 0) {
      basePrice = 1000000;
    }

    // Calculate min and max as 25% either side
    const min = roundToStep(basePrice * 0.75);
    const max = roundToStep(basePrice * 1.25);

    return { min, max };
  };

  const formatMoney = (val) => {
    if (!val) return '$0';
    return `$${Math.round(val).toLocaleString()}`;
  };

  const formatCompact = (val) => {
    if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `$${(val / 1000).toFixed(0)}K`;
    return `$${val.toFixed(0)}`;
  };

  const getNestedValue = (obj, path) => {
    if (!obj) return null;
    const keys = path.split('.');
    let current = obj;
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return null;
      }
    }
    return current;
  };

  const openLightbox = (index) => {
    setCurrentImageIndex(index);
    setLightboxOpen(true);
    trackPhotoView();
  };

  const closeLightbox = () => {
    setLightboxOpen(false);
  };

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % imageUrls.length);
    trackPhotoView();
  };

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + imageUrls.length) % imageUrls.length);
    trackPhotoView();
  };

  // Lightbox swipe (Instagram-style): tracked via a ref, not state, since
  // it fires on every pointer move and shouldn't trigger re-renders.
  // Pointer Events (not separate touch/mouse handlers) cover iPhone
  // Safari touch and desktop mouse-drag with one code path. See
  // utils/swipeGesture.js for exactly what counts as a swipe vs a tap or
  // vertical scroll.
  const lightboxSwipe = useRef({ x: 0, y: 0, active: false });

  const handleLightboxPointerDown = (e) => {
    lightboxSwipe.current = { x: e.clientX, y: e.clientY, active: true };
  };

  const handleLightboxPointerUp = (e) => {
    if (!lightboxSwipe.current.active) return;
    lightboxSwipe.current.active = false;
    const dx = e.clientX - lightboxSwipe.current.x;
    const dy = e.clientY - lightboxSwipe.current.y;
    const direction = getSwipeDirection(dx, dy);
    if (direction === 'next') nextImage();
    else if (direction === 'prev') prevImage();
  };

  const handleQualificationSubmit = async () => {
    if (!qualificationData.buyerType || !qualificationData.seriousnessLevel) {
      alert('Please complete all required fields');
      return;
    }

    // Track qualification form submission
    trackEvent('qualification_form_submitted', {
      property_id: propertyId,
      is_first_home_buyer: qualificationData.isFirstHomeBuyer,
      is_investor: qualificationData.isInvestor,
      buyer_type: qualificationData.buyerType,
      seriousness_level: qualificationData.seriousnessLevel
    });

    if (isIpadMode) {
      // In iPad mode: move to contact details step
      setIpadContactStep(true);
      return;
    }

    // If user is already logged in, skip signup - just save interest data
    if (currentAuthUser) {
      setShowQualificationModal(false);

      if (savedOfferId) {
        try {
          await updateDoc(doc(db, 'offers', savedOfferId), {
            userId: currentAuthUser.uid,
            serious: true,
            isFirstHomeBuyer: qualificationData.isFirstHomeBuyer,
            isInvestor: qualificationData.isInvestor,
            buyerType: qualificationData.buyerType,
            seriousnessLevel: qualificationData.seriousnessLevel,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          console.error('Error updating offer:', err);
        }
      }

      trackEvent('registered_interest_existing_user', {
        property_id: propertyId,
        user_id: currentAuthUser.uid,
        seriousness_level: qualificationData.seriousnessLevel,
      });

      setShowSignupModal(true);
      setShowThankYou(true);
      return;
    }

    setShowQualificationModal(false);
    setShowSignupModal(true);
  };

  const handleIpadContactSubmit = () => {
    // Registered buyers must provide name, email, and phone.
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim()) return;

    // Save qualification + contact info to the offer
    setShowQualificationModal(false);
    setIpadThankYou(true);
    setTimeout(() => resetIpadMode(), 3000);

    if (savedOfferId) {
      updateDoc(doc(db, 'offers', savedOfferId), {
        serious: true,
        isFirstHomeBuyer: qualificationData.isFirstHomeBuyer,
        isInvestor: qualificationData.isInvestor,
        buyerType: qualificationData.buyerType,
        seriousnessLevel: qualificationData.seriousnessLevel,
        buyerName: `${firstName.trim()} ${lastName.trim()}`.trim(),
        buyerEmail: email.trim().toLowerCase(),
        buyerPhone: phone.trim(),
        updatedAt: serverTimestamp(),
      }).catch((err) => console.error('Error updating iPad offer:', err));
    }

    trackEvent('ipad_registered_interest', {
      property_id: propertyId,
      seriousness_level: qualificationData.seriousnessLevel,
    });
  };

  const handleContactSubmit = async (e) => {
    e.preventDefault();
    setSignupError('');

    // Registered buyers must provide name, email, and phone.
    const hasAllContactFields =
      firstName.trim() && lastName.trim() && email.trim() && phone.trim();
    if (registerInterest && !hasAllContactFields) {
      setSignupError('Please provide your name, email, and phone to register interest.');
      return;
    }

    setSubmitting(true);

    try {
      // Save contact + qualification info to the offer
      if (savedOfferId) {
        await updateDoc(doc(db, 'offers', savedOfferId), {
          serious: registerInterest && hasAllContactFields ? true : false,
          isFirstHomeBuyer: qualificationData.isFirstHomeBuyer,
          isInvestor: qualificationData.isInvestor,
          buyerType: qualificationData.buyerType,
          seriousnessLevel: qualificationData.seriousnessLevel,
          buyerName: `${firstName.trim()} ${lastName.trim()}`.trim(),
          buyerEmail: email.trim().toLowerCase() || null,
          buyerPhone: phone.trim() || null,
          // Link to existing user if they're logged in
          ...(currentAuthUser ? { userId: currentAuthUser.uid } : {}),
          updatedAt: serverTimestamp(),
        });
      }

      trackEvent('registered_interest', {
        property_id: propertyId,
        registered_interest: registerInterest,
        has_account: !!currentAuthUser,
      });

      setShowThankYou(true);
    } catch (error) {
      console.error('Register interest error:', error);
      setSignupError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterInterest = () => {
    setRegisterInterest(true);
    setShowPriceOpinionModal(false);
    setShowQualificationModal(true);
    
    trackEvent('register_interest_clicked', {
      property_id: propertyId
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-orange-600"></div>
      </div>
    );
  }

  if (!property) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 text-gray-600">
        Property not found.
      </div>
    );
  }

  const {
    title,
    address,
    formattedAddress,
    description,
    bedrooms,
    bathrooms,
    carSpaces,
    squareFootage,
    price,
    videoUrl,
    aiVideo,
    imageUrls = [],
    propertyJob,
    propertyType,
  } = property;

  // Extract data from propertyJob using helper function
  const propertyData = getNestedValue(propertyJob, 'property_data');
  const priceEstimate = getNestedValue(propertyJob, 'price_estimate');
  const rentalEstimate = getNestedValue(propertyJob, 'rental_estimate');
  const areaStats = getNestedValue(propertyJob, 'area_statistics');

  const displayVideoUrl = aiVideo?.url || videoUrl;
  const typeMap = { 1: 'House', 2: 'Apartment', 3: 'Villa', 4: 'Townhouse', 5: 'Acreage', 6: 'Duplex' };
  const displayPropertyType = typeMap[propertyType] || propertyData?.property_type || 'Property';

  const confirmOpinionModal = showConfirmOpinionModal && (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center"
      >
        <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-3">
          Your price opinion
        </p>
        <div className="text-5xl font-bold text-orange-600 mb-6">
          {formatMoney(priceOpinion)}
        </div>
        <h3 className="text-xl font-bold text-slate-800 mb-2">
          Are you happy to confirm your anonymous opinion?
        </h3>
        <p className="text-sm text-slate-500 mb-8">
          Your opinion stays anonymous — no signup required.
        </p>
        <div className="space-y-3">
          <button
            onClick={confirmPriceOpinion}
            className="w-full bg-gradient-to-r from-[var(--brand-primary,#e48900)] to-[var(--brand-primary-dark,#c64500)] text-white font-bold py-4 rounded-xl shadow-lg hover:shadow-xl transition-all"
          >
            Yes, confirm my opinion
          </button>
          <button
            onClick={() => setShowConfirmOpinionModal(false)}
            className="w-full py-3 text-slate-600 hover:text-slate-900 font-medium transition-colors"
          >
            Adjust my price
          </button>
        </div>
      </motion.div>
    </div>
  );

  // Agency branding CSS variables — undefined (no inline style at all)
  // when there's no linked brand, so every var(--brand-x, <default>)
  // reference throughout this component and PriceOpinionSlider.js falls
  // through to the exact existing Premarket colours unchanged.
  // previewBrand (dashboard-only) lets the branding setup page render this
  // exact same component with proposed, not-yet-saved colours, so agents
  // see precisely what buyers will see before confirming anything.
  const effectiveBrand = previewBrand || brand;
  const brandStyle = computeBrandStyle(effectiveBrand);
  const displayLogoUrl = computeDisplayLogoUrl({ brand: effectiveBrand, agentData });

  // ═══════════════════════════════════════════════════════════════
  // iPad Open Home Mode - Fullscreen price opinion kiosk
  // ═══════════════════════════════════════════════════════════════
  if (isIpadMode) {
    return (
      <div style={brandStyle} className="fixed inset-0 bg-gradient-to-b from-slate-50 to-white flex flex-col items-center justify-between overflow-hidden z-50">
        <div className="absolute top-0 left-0 right-0 z-30">
          <PreviewModeBanner />
        </div>
        {/* Background decoration */}
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-100 rounded-full blur-3xl opacity-60" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-amber-50 rounded-full blur-3xl opacity-60" />
        </div>

        {/* Desktop mode button */}
        <button
          onClick={() => setIsIpadMode(false)}
          className="absolute top-6 right-6 z-20 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-500 text-sm font-medium rounded-lg transition-colors"
        >
          Desktop View
        </button>

        {/* Thank you overlay */}
        {ipadThankYou && (
          <div className="absolute inset-0 bg-white/90 backdrop-blur-sm flex items-center justify-center z-30">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-center"
            >
              <div className="w-24 h-24 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-3xl font-bold text-slate-900 mb-2">Thank You!</h2>
              <p className="text-slate-500 text-lg">Your interest has been registered</p>
            </motion.div>
          </div>
        )}

        {/* Top: Agent info */}
        <div className="relative z-10 w-full pt-8 pb-4 px-8 text-center pointer-events-auto">
          {agentData ? (
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-3">
                {agentData.avatar ? (
                  <Image
                    src={agentData.avatar}
                    alt={`${agentData.firstName || 'Agent'} ${agentData.lastName || ''}`}
                    width={80}
                    height={80}
                    className="rounded-xl object-cover border-2 border-white shadow-lg w-[80px] h-[80px]"
                    unoptimized
                  />
                ) : (
                  <div className="w-[80px] h-[80px] bg-gradient-to-br from-slate-100 to-slate-200 rounded-xl flex items-center justify-center border-2 border-white shadow-lg">
                    <svg className="w-10 h-10 text-slate-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
                {displayLogoUrl && (
                  <Image
                    src={displayLogoUrl}
                    alt="Agency logo"
                    width={56}
                    height={56}
                    className="w-14 h-14 rounded-xl object-contain bg-white shadow-md border border-slate-200"
                    unoptimized
                  />
                )}
              </div>
              <div>
                <p className="font-bold text-slate-900 text-lg">
                  {agentData.firstName} {agentData.lastName}
                </p>
                {agentData.companyName && (
                  <p className="text-sm text-slate-500 font-medium">{agentData.companyName}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="h-[72px]" />
          )}
        </div>

        {/* Middle: Property info + slider */}
        <div className="relative z-10 w-full max-w-xl mx-auto px-8 text-center flex-1 flex flex-col justify-center">
          {/* Property info */}
          <div className="mb-8">
            <span className="px-3 py-1 bg-gradient-to-r from-[var(--brand-primary,#e48900)] to-[var(--brand-primary-dark,#c64500)] text-white text-xs font-bold rounded-full mb-4 inline-block">
              OPEN HOME
            </span>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2">{title}</h1>
            <p className="text-slate-500 text-sm">
              {property?.showSuburbOnly
                ? (address || 'Suburb')
                : (formattedAddress || address)}
            </p>
          </div>

          {/* Price display */}
          <div className="mb-8">
            <p className="text-slate-400 text-sm font-medium mb-3 uppercase tracking-wider">
              What&apos;s your price opinion?
            </p>
            <motion.div
              className="text-6xl md:text-7xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-[var(--brand-primary,#e48900)] to-[var(--brand-primary-dark,#c64500)]"
              key={priceOpinion}
              initial={{ scale: 1.05 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.15 }}
            >
              {formatMoney(priceOpinion)}
            </motion.div>
          </div>

          {/* Slider */}
          <div className="mb-6 px-2">
            <PriceOpinionSlider
              min={minPrice}
              max={maxPrice}
              value={priceOpinion}
              onChange={setPriceOpinion}
              onSlideStart={() => setIsSliding(true)}
              onSlideEnd={() => setIsSliding(false)}
              className="w-full h-4 bg-gradient-to-r from-orange-400 via-yellow-400 to-green-500 rounded-lg appearance-none cursor-pointer ipad-slider"
            />
            <div className="flex justify-between mt-3 text-sm text-slate-400 font-medium">
              <span>{formatCompact(minPrice)}</span>
              <span>{formatCompact(maxPrice)}</span>
            </div>
          </div>

          {/* Instruction */}
          <p className="text-slate-400 text-sm">
            Drag the slider and release to confirm your opinion
          </p>
        </div>

        {/* Bottom: Powered by Premarket */}
        <div className="relative z-20 w-full pb-8 pt-4 flex flex-col items-center gap-2">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Powered by</p>
          <Image
            src="https://premarketvideos.b-cdn.net/assets/logo.png"
            alt="Premarket"
            width={130}
            height={32}
            className="mx-auto opacity-60"
            unoptimized
          />
        </div>

        {confirmOpinionModal}

        {/* Qualification Modal for iPad mode */}
        {showQualificationModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-40 p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 relative max-h-[90vh] overflow-y-auto"
            >
              <button
                onClick={() => {
                  setShowQualificationModal(false);
                  setRegisterInterest(false);
                  resetIpadMode();
                }}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {!ipadContactStep ? (
                <>
                  <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <h3 className="text-2xl font-bold text-slate-800 mb-1">
                      Opinion: {formatMoney(priceOpinion)}
                    </h3>
                    <p className="text-slate-600">
                      Tell us a bit about yourself
                    </p>
                  </div>

                  <div className="space-y-5">
                    {/* First Home Buyer Toggle */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                      <label className="flex items-center justify-between cursor-pointer">
                        <span className="text-sm font-semibold text-slate-800">First home buyer?</span>
                        <input
                          type="checkbox"
                          checked={qualificationData.isFirstHomeBuyer}
                          onChange={(e) => setQualificationData({ ...qualificationData, isFirstHomeBuyer: e.target.checked })}
                          className="w-5 h-5 text-orange-600 rounded focus:ring-2 focus:ring-orange-500"
                        />
                      </label>
                    </div>

                    {/* Investor Toggle */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                      <label className="flex items-center justify-between cursor-pointer">
                        <span className="text-sm font-semibold text-slate-800">Are you an investor?</span>
                        <input
                          type="checkbox"
                          checked={qualificationData.isInvestor}
                          onChange={(e) => setQualificationData({ ...qualificationData, isInvestor: e.target.checked })}
                          className="w-5 h-5 text-orange-600 rounded focus:ring-2 focus:ring-orange-500"
                        />
                      </label>
                    </div>

                    {/* Buyer Type */}
                    <div>
                      <label className="block text-sm font-semibold text-slate-800 mb-3">Finance status *</label>
                      <div className="grid grid-cols-2 gap-3">
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
                            className={`px-4 py-3 rounded-lg border-2 text-sm font-semibold transition-all ${
                              qualificationData.buyerType === option.value
                                ? 'border-orange-600 bg-orange-50 text-orange-600'
                                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Seriousness */}
                    <div>
                      <label className="block text-sm font-semibold text-slate-800 mb-3">Interest level *</label>
                      <select
                        value={qualificationData.seriousnessLevel}
                        onChange={(e) => setQualificationData({ ...qualificationData, seriousnessLevel: e.target.value })}
                        className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all text-slate-800"
                      >
                        <option value="">Select your interest level</option>
                        <option value="just_browsing">Just Browsing</option>
                        <option value="interested">Interested</option>
                        <option value="very_interested">Very Interested</option>
                        <option value="ready_to_buy">Ready to Buy</option>
                      </select>
                    </div>

                    {/* Submit */}
                    <button
                      onClick={handleQualificationSubmit}
                      disabled={!qualificationData.buyerType || !qualificationData.seriousnessLevel}
                      className="w-full bg-gradient-to-r from-[var(--brand-primary,#e48900)] to-[var(--brand-primary-dark,#c64500)] text-white font-bold py-4 rounded-xl transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>

                    {/* Skip */}
                    <button
                      onClick={() => {
                        setShowQualificationModal(false);
                        setIpadThankYou(true);
                        setTimeout(() => resetIpadMode(), 2500);
                      }}
                      className="w-full py-3 text-slate-500 hover:text-slate-700 font-medium transition-colors text-sm"
                    >
                      Skip — just submit my price opinion
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <h3 className="text-2xl font-bold text-slate-800 mb-1">
                      Register Your Interest
                    </h3>
                    <p className="text-slate-600">
                      Enter your details so the agent can get in touch
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-semibold text-slate-800 mb-2">First name *</label>
                        <input
                          type="text"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          placeholder="First name"
                          className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all text-slate-800"
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-800 mb-2">Last name *</label>
                        <input
                          type="text"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          placeholder="Last name"
                          className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all text-slate-800"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-800 mb-2">Email *</label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="your@email.com"
                        className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all text-slate-800"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-800 mb-2">Phone *</label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="0400 000 000"
                        className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all text-slate-800"
                      />
                    </div>

                    <button
                      onClick={handleIpadContactSubmit}
                      disabled={!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim()}
                      className="w-full bg-gradient-to-r from-[var(--brand-primary,#e48900)] to-[var(--brand-primary-dark,#c64500)] text-white font-bold py-4 rounded-xl transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                    >
                      Register Interest
                    </button>

                    <button
                      onClick={() => setIpadContactStep(false)}
                      className="w-full py-3 text-slate-500 hover:text-slate-700 font-medium transition-colors text-sm"
                    >
                      Back
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </div>
    );
  }

  const marketCopy = getMarketStatusCopy(property?.listingStatus);
  const yearBuilt = propertyData?.year_built;
  const landSize = propertyData?.land_size;
  const heroAddress = property?.showSuburbOnly ? (address || 'Suburb unavailable') : (formattedAddress || address);
  const openConfirmOpinion = () => setShowConfirmOpinionModal(true);

  // Restyled confirm-opinion modal used only by the redesigned page — the
  // original `confirmOpinionModal` above is left untouched and still used
  // by the separate iPad open-home kiosk mode.
  const premiumConfirmOpinionModal = showConfirmOpinionModal && (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 text-center"
      >
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Your price opinion
        </p>
        <div className="text-4xl sm:text-5xl font-semibold text-[var(--brand-primary,#c2410c)] mb-6 tabular-nums">
          {formatMoney(priceOpinion)}
        </div>
        <h3 className="text-lg font-semibold text-slate-900 mb-2">
          Confirm your anonymous opinion?
        </h3>
        <p className="text-sm text-slate-500 mb-8">
          No signup required — your response stays anonymous.
        </p>
        <div className="space-y-3">
          <button
            onClick={confirmPriceOpinion}
            className="w-full bg-[var(--brand-primary,#c2410c)] hover:opacity-90 text-[var(--brand-text-on-primary,#ffffff)] font-semibold py-3.5 rounded-xl transition-opacity"
          >
            Yes, confirm my opinion
          </button>
          <button
            onClick={() => setShowConfirmOpinionModal(false)}
            className="w-full py-3 text-slate-500 hover:text-slate-800 font-medium transition-colors text-sm"
          >
            Adjust my price
          </button>
        </div>
      </motion.div>
    </div>
  );

  return (
    <div style={brandStyle} className={`${playfairDisplay.variable} min-h-screen bg-white antialiased`}>
      <PreviewModeBanner />
      <PropertyHeader
        agencyName={agentData?.companyName}
        agencyLogoUrl={displayLogoUrl}
        onOpenIpadMode={() => setIsIpadMode(true)}
      />

      <PropertyHero
        title={title}
        locality={heroAddress}
        bedrooms={bedrooms}
        bathrooms={bathrooms}
        carSpaces={carSpaces}
        landSize={landSize}
        imageUrl={imageUrls[0]}
        videoUrl={displayVideoUrl}
        hasVideo={!!displayVideoUrl}
        heroVideoPaused={videoModalOpen}
        onWatchVideo={() => setVideoModalOpen(true)}
      />

      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-10 sm:py-16">
        {/*
          items-stretch (not items-start): on mobile this grid is a single
          column, so "stretching to match the row" has no visible effect —
          each card is naturally just its own content height either way.
          At the md: two-column breakpoint, it makes both card OUTER
          borders/backgrounds extend to the same height as their taller
          sibling, while each card's own internal content still sits
          naturally near the top (no mt-auto / forced internal spacing —
          see PropertyInfoCard.js).
        */}
        <div className="grid md:grid-cols-2 gap-5 sm:gap-6 items-stretch mb-10 sm:mb-14">
          <PriceOpinionCard
            propertyId={propertyId}
            priceOpinion={priceOpinion}
            minPrice={minPrice}
            maxPrice={maxPrice}
            onChange={setPriceOpinion}
            onSlideStart={() => setIsSliding(true)}
            onSlideEnd={() => setIsSliding(false)}
            onSubmitOpinion={openConfirmOpinion}
            onRegisterInterest={handleRegisterInterest}
            formatMoney={formatMoney}
            formatCompact={formatCompact}
            heading={marketCopy.priceOpinionHeading}
            subcopy={marketCopy.priceOpinionSubcopy}
            interestHeading={marketCopy.interestHeading}
            interestSubcopy={marketCopy.interestSubcopy}
          />
          <PropertyInfoCard
            description={description}
            showFullDescription={showFullDescription}
            onToggleDescription={() => setShowFullDescription(!showFullDescription)}
            bedrooms={bedrooms}
            bathrooms={bathrooms}
            carSpaces={carSpaces}
            landSize={landSize}
            squareFootage={squareFootage}
            yearBuilt={yearBuilt}
            propertyType={displayPropertyType}
          />
        </div>

        {imageUrls.length > 1 && (
          <div className="mb-10 sm:mb-14">
            <PropertyGallery imageUrls={imageUrls} title={title} onOpenImage={openLightbox} />
          </div>
        )}

        {property?.location?.latitude && property?.location?.longitude && !property?.showSuburbOnly && (
          <div className="mb-10 sm:mb-14">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">Location</h3>
            <div className="rounded-xl overflow-hidden border border-slate-200">
              <iframe
                width="100%"
                height="320"
                style={{ border: 0 }}
                loading="lazy"
                allowFullScreen
                src={`https://www.google.com/maps/embed/v1/place?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&q=${property.location.latitude},${property.location.longitude}&zoom=15`}
              />
            </div>
          </div>
        )}

        <AgentSignOff agentData={agentData} displayLogoUrl={displayLogoUrl} />
      </div>

      {premiumConfirmOpinionModal}

      {/* Price Opinion Saved Modal */}
      {showPriceOpinionModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-8 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowPriceOpinionModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-2xl font-semibold text-slate-900 mb-3" style={{ fontFamily: 'var(--font-playfair, serif)' }}>
                Opinion saved
              </h3>
              <div className="text-4xl font-semibold text-[var(--brand-primary,#c2410c)] mb-4 tabular-nums">
                {formatMoney(priceOpinion)}
              </div>
              <p className="text-slate-500 mb-6 text-sm">
                You&apos;ve left a price opinion for this property.
              </p>
            </div>

            <div className="space-y-4">
              <div className="bg-slate-50 rounded-xl p-6 border border-slate-200 text-center">
                <h4 className="font-semibold text-slate-900 mb-2">{marketCopy.interestHeading}</h4>
                <p className="text-sm text-slate-500 mb-4">
                  {marketCopy.interestSubcopy}
                </p>
                <button
                  onClick={handleRegisterInterest}
                  className="w-full bg-[var(--brand-primary,#c2410c)] hover:opacity-90 text-[var(--brand-text-on-primary,#ffffff)] font-semibold py-3.5 rounded-xl transition-opacity"
                >
                  Register my interest
                </button>
              </div>

              <button
                onClick={() => setShowPriceOpinionModal(false)}
                className="w-full py-3 text-slate-500 hover:text-slate-800 font-medium transition-colors"
              >
                Continue browsing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Qualification Modal */}
      {showQualificationModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => {
                setShowQualificationModal(false);
                setRegisterInterest(false);
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="text-center mb-6">
              <h3 className="text-xl font-semibold text-slate-900 mb-2" style={{ fontFamily: 'var(--font-playfair, serif)' }}>
                Tell us a little more
              </h3>
              <p className="text-slate-500 text-sm">
                This helps the agent understand your circumstances.
              </p>
            </div>

            <div className="space-y-5">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm font-medium text-slate-800">Are you a first home buyer?</span>
                  <input
                    type="checkbox"
                    checked={qualificationData.isFirstHomeBuyer}
                    onChange={(e) => setQualificationData({
                      ...qualificationData,
                      isFirstHomeBuyer: e.target.checked
                    })}
                    className="w-5 h-5 rounded focus:ring-2 focus:ring-slate-400"
                    style={{ accentColor: 'var(--brand-primary, #c2410c)' }}
                  />
                </label>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm font-medium text-slate-800">Are you an investor?</span>
                  <input
                    type="checkbox"
                    checked={qualificationData.isInvestor}
                    onChange={(e) => setQualificationData({
                      ...qualificationData,
                      isInvestor: e.target.checked
                    })}
                    className="w-5 h-5 rounded focus:ring-2 focus:ring-slate-400"
                    style={{ accentColor: 'var(--brand-primary, #c2410c)' }}
                  />
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-800 mb-3">
                  Finance status
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'cash', label: 'Cash Buyer' },
                    { value: 'approved_finance', label: 'Approved Finance' },
                    { value: 'pre_approval', label: 'Pre-Approval' },
                    { value: 'not_yet', label: 'Not Yet' }
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setQualificationData({
                        ...qualificationData,
                        buyerType: option.value
                      })}
                      className={`px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
                        qualificationData.buyerType === option.value
                          ? 'border-slate-800 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-800 mb-3">
                  How serious are you about this property?
                </label>
                <select
                  value={qualificationData.seriousnessLevel}
                  onChange={(e) => setQualificationData({
                    ...qualificationData,
                    seriousnessLevel: e.target.value
                  })}
                  className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-400 focus:border-transparent outline-none transition-all text-slate-800"
                >
                  <option value="">Select your interest level</option>
                  <option value="just_browsing">Just Browsing</option>
                  <option value="interested">Interested</option>
                  <option value="very_interested">Very Interested</option>
                  <option value="ready_to_buy">Ready to Buy</option>
                </select>
              </div>

              <button
                onClick={handleQualificationSubmit}
                disabled={!qualificationData.buyerType || !qualificationData.seriousnessLevel}
                className="w-full bg-[var(--brand-primary,#c2410c)] hover:opacity-90 text-[var(--brand-text-on-primary,#ffffff)] font-semibold py-3.5 rounded-xl transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Signup / Register Interest Modal */}
      {showSignupModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => {
                setShowSignupModal(false);
                setShowThankYou(false);
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {showThankYou ? (
              <div className="text-center">
                <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-2xl font-semibold text-slate-900 mb-3" style={{ fontFamily: 'var(--font-playfair, serif)' }}>
                  You&apos;re all set
                </h3>
                <p className="text-slate-500 mb-8 text-sm">
                  Your interest in this property has been registered.
                </p>
                <a
                  href="/listings"
                  className="inline-flex items-center justify-center w-full px-6 py-3.5 bg-[var(--brand-primary,#c2410c)] hover:opacity-90 text-[var(--brand-text-on-primary,#ffffff)] font-semibold rounded-xl transition-opacity"
                >
                  Browse more properties
                </a>
              </div>
            ) : (
              <>
                <div className="text-center mb-6">
                  <h3 className="text-xl font-semibold text-slate-900 mb-2" style={{ fontFamily: 'var(--font-playfair, serif)' }}>
                    Register your interest
                  </h3>
                  <p className="text-slate-500 text-sm">
                    Enter your details so the agent can get in touch.
                  </p>
                </div>

                <form onSubmit={handleContactSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">First Name</label>
                      <input
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        required
                        className="text-slate-900 placeholder:text-slate-400 w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-400 focus:border-transparent outline-none transition-all"
                        placeholder="John"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Last Name</label>
                      <input
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        required
                        className="text-slate-900 placeholder:text-slate-400 w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-400 focus:border-transparent outline-none transition-all"
                        placeholder="Doe"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="text-slate-900 placeholder:text-slate-400 w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-400 focus:border-transparent outline-none transition-all"
                      placeholder="john@example.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Phone</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                      className="text-slate-900 placeholder:text-slate-400 w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-400 focus:border-transparent outline-none transition-all"
                      placeholder="0400 000 000"
                    />
                  </div>

                  {signupError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                      {signupError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-[var(--brand-primary,#c2410c)] hover:opacity-90 text-[var(--brand-text-on-primary,#ffffff)] font-semibold py-3.5 rounded-lg transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? 'Submitting...' : 'Register Interest'}
                  </button>
                </form>

                <p className="text-xs text-center text-slate-400 mt-4">
                  100% free &bull; No obligation &bull; The agent will be in touch
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Lightbox Modal */}
      {lightboxOpen && imageUrls.length > 0 && (
        <div
          className="fixed inset-0 bg-black/95 z-[60] flex items-center justify-center"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeLightbox(); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') closeLightbox();
            if (e.key === 'ArrowLeft') prevImage();
            if (e.key === 'ArrowRight') nextImage();
          }}
          tabIndex={0}
        >
          <button
            onClick={closeLightbox}
            className="absolute top-4 right-4 z-10 w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors"
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="absolute top-4 left-4 z-10 bg-black/50 text-white px-4 py-2 rounded-full text-sm font-semibold">
            {currentImageIndex + 1} / {imageUrls.length}
          </div>

          {imageUrls.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); prevImage(); }}
              className="absolute left-4 z-10 w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors"
            >
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          <div
            className="relative max-w-7xl max-h-[90vh] w-full h-full flex items-center justify-center p-4 select-none"
            style={{ touchAction: 'pan-y' }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={handleLightboxPointerDown}
            onPointerUp={handleLightboxPointerUp}
          >
            <Image
              src={imageUrls[currentImageIndex]}
              alt={`${title} - Image ${currentImageIndex + 1}`}
              width={1200}
              height={800}
              className="max-w-full max-h-full object-contain select-none pointer-events-none"
              unoptimized
              draggable={false}
            />
          </div>

          {imageUrls.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); nextImage(); }}
              className="absolute right-4 z-10 w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors"
            >
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}

          {imageUrls.length > 1 && (
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10 flex gap-2 bg-black/50 p-3 rounded-full max-w-[90vw] overflow-x-auto">
              {imageUrls.map((url, index) => (
                <div
                  key={index}
                  onClick={(e) => { e.stopPropagation(); setCurrentImageIndex(index); }}
                  className={`relative w-16 h-16 rounded-lg overflow-hidden cursor-pointer flex-shrink-0 transition-all ${
                    index === currentImageIndex ? 'ring-2 ring-white scale-110' : 'opacity-60 hover:opacity-100'
                  }`}
                >
                  <Image src={url} alt={`Thumbnail ${index + 1}`} fill className="object-cover" unoptimized />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Video Modal */}
      {videoModalOpen && displayVideoUrl && (
        <div
          className="fixed inset-0 bg-black/95 z-[60] flex items-center justify-center"
          onMouseDown={(e) => { if (e.target === e.currentTarget) { setVideoModalOpen(false); setVideoPlaybackError(false); } }}
        >
          <button
            onClick={() => { setVideoModalOpen(false); setVideoPlaybackError(false); }}
            className="absolute top-4 right-4 z-10 w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors"
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="relative w-full max-w-5xl mx-4" onClick={(e) => e.stopPropagation()}>
            {videoPlaybackError ? (
              <div className="w-full aspect-video rounded-xl bg-slate-900 flex flex-col items-center justify-center gap-3 text-center px-6">
                <p className="text-white/80 text-sm">This video couldn&apos;t be played on your device.</p>
                <button
                  onClick={() => { setVideoModalOpen(false); setVideoPlaybackError(false); }}
                  className="text-orange-400 text-sm font-semibold hover:text-orange-300"
                >
                  Close
                </button>
              </div>
            ) : (
              <video
                src={displayVideoUrl}
                controls
                autoPlay
                playsInline
                onError={() => setVideoPlaybackError(true)}
                className="w-full rounded-xl"
                style={{ maxHeight: '85vh' }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
