'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase/clientApp';
import { doc, getDoc, addDoc, collection, serverTimestamp, updateDoc, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import Image from 'next/image';
import { motion } from 'framer-motion';
import AgentFooter from '../components/AgentFooter';
import Nav from '../components/Nav';
import LikeButton from './LikeButton';
import { usePropertyEngagement } from '../hooks/usePropertyEngagement';
import PriceOpinionSlider, { roundToStep } from './PriceOpinionSlider';
import { computeBrandStyle, computeDisplayLogoUrl } from '../utils/brandStyle';

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

  // Nearby properties state
  const [nearbyProperties, setNearbyProperties] = useState([]);

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

  // Fetch nearby properties based on geohash - only active properties
  useEffect(() => {
    if (!property) return;

    const fetchNearbyProperties = async () => {
      try {
        // Query active properties
        const nearbyQuery = query(
          collection(db, 'properties'),
          where('active', '==', true),
          where('visibility', '==', true),
          orderBy('createdAt', 'desc'),
          limit(12)
        );

        const snapshot = await getDocs(nearbyQuery);
        const nearby = snapshot.docs
          .filter(doc => doc.id !== propertyId) // Exclude current property
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .slice(0, 4);

        setNearbyProperties(nearby);
      } catch (error) {
        console.error('Error fetching nearby properties:', error);
      }
    };

    fetchNearbyProperties();
  }, [property, propertyId]);

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
      
      // First try to find a session-based offer
      const sessionQuery = query(
        collection(db, 'offers'),
        where('propertyId', '==', propId),
        where('sessionId', '==', sessionId),
        orderBy('updatedAt', 'desc'),
        limit(1)
      );
      
      const sessionSnapshot = await getDocs(sessionQuery);
      
      if (!sessionSnapshot.empty) {
        const previousOffer = sessionSnapshot.docs[0];
        setSavedOfferId(previousOffer.id);
        if (previousOffer.data().offerAmount) {
          const roundedOffer = roundToStep(previousOffer.data().offerAmount);
          setPriceOpinion(roundedOffer);
          return;
        }
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

  return (
    <div style={brandStyle} className="min-h-screen bg-white overflow-x-hidden">
      <Nav />

      {/* Hero Section with Full-Width Gradient */}
      <div className="relative bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden">
        {/* Background gradient decorations - full width */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-500 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500 rounded-full blur-3xl" />
        </div>

        {/* Address Bar */}
        <div className="relative z-10 py-4">
          <div className="max-w-7xl mx-auto px-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`px-3 py-1 text-white text-xs font-bold rounded-full ${
                property?.listingStatus === 'on-market'
                  ? 'bg-gradient-to-r from-emerald-500 to-emerald-700'
                  : 'bg-gradient-to-r from-[var(--brand-primary,#e48900)] to-[var(--brand-primary-dark,#c64500)]'
              }`}>
                {property?.listingStatus === 'on-market' ? 'ON MARKET' : 'PRE-MARKET'}
              </span>
              <span className="text-white/90 text-sm font-medium hidden sm:inline">
                {property?.showSuburbOnly
                  ? (address || 'Suburb')
                  : (formattedAddress || address)}
              </span>
            </div>
            <div className="flex items-center gap-3 text-white/80 text-sm">
              <button
                onClick={() => setIsIpadMode(true)}
                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/80 text-xs font-medium rounded-lg transition-colors backdrop-blur-sm flex items-center gap-1.5"
                title="Open Home iPad Mode"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                iPad
              </button>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
              </svg>
              <span className="sm:hidden text-xs">
                {property?.showSuburbOnly
                  ? (address || 'Suburb')
                  : (formattedAddress?.split(',')[0] || address)}
              </span>
            </div>
          </div>
        </div>

        {/* Image Gallery */}
        <div className="max-w-7xl mx-auto px-4 pb-6 relative z-10">
          {imageUrls.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3">
              {/* Main large image — with video play button if video exists */}
              <div
                className="md:col-span-2 relative aspect-[16/10] md:aspect-[16/9] cursor-pointer group rounded-xl overflow-hidden"
                onClick={() => displayVideoUrl ? setVideoModalOpen(true) : openLightbox(0)}
              >
                <Image
                  src={imageUrls[0]}
                  alt={title}
                  fill
                  className="object-cover group-hover:brightness-90 group-hover:scale-105 transition-all duration-300"
                  unoptimized
                  priority
                />
                {/* Video play button overlay */}
                {displayVideoUrl && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-20 h-20 bg-black/60 group-hover:bg-black/80 rounded-full flex items-center justify-center transition-all group-hover:scale-110 shadow-2xl backdrop-blur-sm">
                      <svg className="w-9 h-9 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                )}
                <div className="absolute bottom-4 left-4 flex items-center gap-2">
                  <span className="px-3 py-1.5 bg-gradient-to-r from-[var(--brand-primary,#e48900)] to-[var(--brand-primary-dark,#c64500)] text-white text-xs font-bold rounded-lg shadow-lg">
                    {displayPropertyType}
                  </span>
                  {displayVideoUrl && (
                    <span className="px-3 py-1.5 bg-black/60 backdrop-blur-sm text-white text-xs font-bold rounded-lg shadow-lg flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Video Tour
                    </span>
                  )}
                </div>
              </div>
              {/* Side images */}
              <div className="hidden md:grid grid-rows-2 gap-3">
                {imageUrls.slice(1, 3).map((url, index) => (
                  <div
                    key={index}
                    className="relative aspect-[16/9] cursor-pointer group rounded-xl overflow-hidden"
                    onClick={() => openLightbox(index + 1)}
                  >
                    <Image
                      src={url}
                      alt={`${title} - ${index + 2}`}
                      fill
                      className="object-cover group-hover:brightness-90 group-hover:scale-105 transition-all duration-300"
                      unoptimized
                    />
                    {index === 1 && imageUrls.length > 3 && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <span className="text-white text-lg font-bold">+{imageUrls.length - 3} photos</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-8 lg:py-12">
        <div className="grid lg:grid-cols-5 gap-8 lg:gap-12">

          {/* Left: Property Details (3 cols) */}
          <div className="lg:col-span-3">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-2">
                {title}
              </h1>
              <div className="flex items-center gap-2 text-slate-600 mb-6">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                </svg>
                <span className="font-medium">
                  {property?.showSuburbOnly
                    ? (address || 'Suburb unavailable')
                    : (formattedAddress || address)}
                </span>
              </div>

              {/* Property Features */}
              <div className="flex flex-wrap gap-3 mb-8">
                {bedrooms && (
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 rounded-xl">
                    <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                    </svg>
                    <span className="font-semibold text-slate-800">{bedrooms} Beds</span>
                  </div>
                )}
                {bathrooms && (
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 rounded-xl">
                    <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
                    </svg>
                    <span className="font-semibold text-slate-800">{bathrooms} Baths</span>
                  </div>
                )}
                {carSpaces && (
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 rounded-xl">
                    <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                    </svg>
                    <span className="font-semibold text-slate-800">{carSpaces} Cars</span>
                  </div>
                )}
                {squareFootage && (
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 rounded-xl">
                    <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                    </svg>
                    <span className="font-semibold text-slate-800">{squareFootage}m²</span>
                  </div>
                )}
                {propertyData?.land_size && (
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 rounded-xl">
                    <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                    <span className="font-semibold text-slate-800">{propertyData.land_size}m² land</span>
                  </div>
                )}
              </div>

              {/* What is Premarket Info Box */}
              <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-2xl p-6 border border-orange-200 mb-8">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-[var(--brand-primary,#e48900)] to-[var(--brand-primary-dark,#c64500)] rounded-xl flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-lg mb-2">What is Premarket?</h3>
                    <p className="text-slate-700 leading-relaxed">
                      Premarket helps agents collect <strong>real buyer price opinions</strong> on properties. Share what you think this property is worth, register your interest, and help the owner understand true market value.
                    </p>
                  </div>
                </div>
              </div>

              {/* Agent Details Card */}
              {agentData && (
                <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-5 mb-8">
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">Listing Agent</h3>
                  <div className="flex items-center gap-4">
                    {/* Agent Avatar */}
                    <div className="flex-shrink-0">
                      {agentData.avatar ? (
                        <Image
                          src={agentData.avatar}
                          alt={`${agentData.firstName || 'Agent'} ${agentData.lastName || ''}`}
                          width={56}
                          height={56}
                          className="rounded-xl object-cover border-2 border-slate-100"
                          unoptimized
                        />
                      ) : (
                        <div className="w-14 h-14 bg-gradient-to-br from-slate-100 to-slate-200 rounded-xl flex items-center justify-center border-2 border-slate-100">
                          <svg className="w-7 h-7 text-slate-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                    </div>

                    {/* Agent Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-900 text-lg">
                        {agentData.firstName} {agentData.lastName}
                      </p>
                      {agentData.companyName && (
                        <p className="text-sm text-slate-600 font-medium flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                          </svg>
                          <span className="truncate">{agentData.companyName}</span>
                        </p>
                      )}
                    </div>

                    {/* Agency Logo */}
                    {displayLogoUrl && (
                      <div className="flex-shrink-0">
                        <Image
                          src={displayLogoUrl}
                          alt="Agency logo"
                          width={48}
                          height={48}
                          className="w-12 h-12 rounded-xl object-contain bg-white shadow-sm border border-slate-200"
                          unoptimized
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Description */}
              {description && (
                <div className="mb-8">
                  <h3 className="text-xl font-bold text-slate-900 mb-4">About This Property</h3>
                  <div className="prose prose-slate max-w-none">
                    <div className={`text-slate-600 leading-relaxed space-y-3 ${!showFullDescription && 'line-clamp-4'}`}>
                      {description.split('\n').filter(p => p.trim()).map((paragraph, i) => (
                        <p key={i}>{paragraph}</p>
                      ))}
                    </div>
                    {description.length > 300 && (
                      <button
                        onClick={() => setShowFullDescription(!showFullDescription)}
                        className="text-orange-600 font-semibold mt-2 hover:text-orange-700"
                      >
                        {showFullDescription ? 'Show less' : 'Read more'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* More Photos Grid - Mobile */}
              {imageUrls.length > 1 && (
                <div className="md:hidden mb-8">
                  <h3 className="text-lg font-bold text-slate-900 mb-3">More Photos</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {imageUrls.slice(1, 7).map((url, index) => (
                      <div
                        key={index}
                        onClick={() => openLightbox(index + 1)}
                        className="relative aspect-square rounded-lg overflow-hidden cursor-pointer"
                      >
                        <Image
                          src={url}
                          alt={`${title} - ${index + 2}`}
                          fill
                          className="object-cover"
                          unoptimized
                        />
                        {index === 5 && imageUrls.length > 7 && (
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                            <span className="text-white text-sm font-bold">+{imageUrls.length - 7}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Property Details Grid */}
              {propertyData?.year_built && (
                <div className="mb-8">
                  <h3 className="text-lg font-bold text-slate-900 mb-3">Property Details</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 rounded-xl p-4">
                      <div className="text-sm text-slate-500 mb-1">Year Built</div>
                      <div className="text-lg font-bold text-slate-900">{propertyData.year_built}</div>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-4">
                      <div className="text-sm text-slate-500 mb-1">Property Type</div>
                      <div className="text-lg font-bold text-slate-900">{displayPropertyType}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Map Section — hidden when address is suburb-only */}
              {property?.location?.latitude && property?.location?.longitude && !property?.showSuburbOnly && (
                <div className="mb-8">
                  <h3 className="text-lg font-bold text-slate-900 mb-3">Location</h3>
                  <div className="rounded-xl overflow-hidden border border-slate-200">
                    <iframe
                      width="100%"
                      height="300"
                      style={{ border: 0 }}
                      loading="lazy"
                      allowFullScreen
                      src={`https://www.google.com/maps/embed/v1/place?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&q=${property.location.latitude},${property.location.longitude}&zoom=15`}
                    />
                  </div>
                </div>
              )}
            </motion.div>
          </div>

          {/* Right: Price Opinion Panel (2 cols) */}
          <div className="lg:col-span-2">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="sticky top-24"
            >
              {/* Price Opinion Card */}
              <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden mb-6">
                <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-6 text-center">
                  <h3 className="text-xl font-bold text-white mb-1">What&apos;s Your Price Opinion?</h3>
                  <p className="text-white/90 text-sm">No signup required</p>
                </div>

                <div className="p-6">
                  {/* Big Price Display */}
                  <div className="text-center mb-6">
                    <motion.div
                      className="text-4xl md:text-5xl font-bold text-orange-600"
                      key={priceOpinion}
                      initial={{ scale: 1.05 }}
                      animate={{ scale: 1 }}
                      transition={{ duration: 0.2 }}
                    >
                      {formatMoney(priceOpinion)}
                    </motion.div>
                  </div>

                  {/* Slider */}
                  <div className="mb-4">
                    <PriceOpinionSlider
                      min={minPrice}
                      max={maxPrice}
                      value={priceOpinion}
                      onChange={setPriceOpinion}
                      onSlideStart={() => setIsSliding(true)}
                      onSlideEnd={() => setIsSliding(false)}
                      className="w-full h-3 bg-gradient-to-r from-orange-400 via-yellow-400 to-green-500 rounded-lg appearance-none cursor-pointer slider-thumb"
                    />
                    <div className="flex justify-between mt-2 text-xs text-slate-500">
                      <span>{formatCompact(minPrice)}</span>
                      <span>{formatCompact(maxPrice)}</span>
                    </div>
                  </div>

                  <p className="text-xs text-center text-slate-500">
                    Drag the slider to share your opinion • No signup needed
                  </p>
                </div>
              </div>

              {/* Register Interest Card - Separate */}
              <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-amber-500 rounded-xl flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
                      </svg>
                    </div>
                    <h4 className="font-bold text-slate-800 text-lg flex-1">
                      Interested in this property?
                    </h4>
                    {propertyId && <LikeButton propertyId={propertyId} size="md" />}
                  </div>
                  <p className="text-sm text-slate-600 mb-4">
                    Register your interest to be first in line when this property goes to market. Get priority access before open homes.
                  </p>
                  <button
                    onClick={handleRegisterInterest}
                    className="w-full bg-gradient-to-r from-[var(--brand-primary,#e48900)] to-[var(--brand-primary-dark,#c64500)] text-white font-bold py-3 rounded-xl hover:shadow-lg transition-all"
                  >
                    Register My Interest
                  </button>
                  <p className="text-xs text-center text-slate-500 mt-3">
                    100% free • No obligation
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* How You Got Here Section */}
      <div className="bg-gradient-to-br from-slate-50 to-white py-16 lg:py-20">
        <div className="max-w-5xl mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              How It Works
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              Your agent wants to know what you think this property is worth
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Step 1 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-2xl p-6 shadow-lg border border-slate-200"
            >
              <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-amber-500 rounded-xl flex items-center justify-center mb-4">
                <span className="text-white font-bold text-lg">1</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Agent Adds Property</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                A real estate agent adds this property to Premarket to collect buyer price opinions and gauge interest.
              </p>
            </motion.div>

            {/* Step 2 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="bg-white rounded-2xl p-6 shadow-lg border border-slate-200"
            >
              <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-amber-500 rounded-xl flex items-center justify-center mb-4">
                <span className="text-white font-bold text-lg">2</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">You Receive the Link</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                The agent shares this property with you — whether at an open home, via their database, or through a campaign.
              </p>
            </motion.div>

            {/* Step 3 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 }}
              className="bg-white rounded-2xl p-6 shadow-lg border border-slate-200"
            >
              <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-amber-500 rounded-xl flex items-center justify-center mb-4">
                <span className="text-white font-bold text-lg">3</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Share Your Price Opinion</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Tell the agent what you think it&apos;s worth, register your interest, and stay updated on the property.
              </p>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Nearby Properties Section */}
      {nearbyProperties.length > 0 && (
        <div className="py-16 lg:py-20 bg-gradient-to-br from-slate-50 to-white">
          <div className="max-w-7xl mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
                More Properties Nearby
              </h2>
              <p className="text-lg text-slate-600">
                Discover other exclusive pre-market properties in your area
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {nearbyProperties.map((prop) => (
                <a
                  key={prop.id}
                  href={`/find-property?propertyId=${prop.id}`}
                  className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden group hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
                >
                  <div className="aspect-video relative overflow-hidden">
                    {prop.imageUrls?.[0] ? (
                      <Image
                        src={prop.imageUrls[0]}
                        alt={prop.title || 'Property'}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        unoptimized
                      />
                    ) : (
                      <div className="w-full h-full bg-slate-200 flex items-center justify-center">
                        <svg className="w-12 h-12 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                        </svg>
                      </div>
                    )}
                    <div className="absolute top-3 left-3">
                      <span className="px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-xs font-semibold">
                        Pre-Market
                      </span>
                    </div>
                  </div>
                  <div className="p-5">
                    <h3 className="font-bold text-slate-900 mb-1 truncate">
                      {prop.title || 'Property'}
                    </h3>
                    <p className="text-sm text-slate-600 mb-3 truncate flex items-center gap-1">
                      <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                      </svg>
                      {prop.showSuburbOnly
                        ? (prop.address || 'Suburb unavailable')
                        : (prop.formattedAddress || prop.address || 'Address unavailable')}
                    </p>
                    <div className="flex items-center gap-3 text-sm text-slate-700 mb-4">
                      {prop.bedrooms && (
                        <span className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                          </svg>
                          {prop.bedrooms}
                        </span>
                      )}
                      {prop.bathrooms && (
                        <span className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
                          </svg>
                          {prop.bathrooms}
                        </span>
                      )}
                      {prop.carSpaces && (
                        <span className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                          </svg>
                          {prop.carSpaces}
                        </span>
                      )}
                    </div>
                    <div className="w-full text-center py-2 bg-gradient-to-r from-[var(--brand-primary,#e48900)] to-[var(--brand-primary-dark,#c64500)] text-white text-sm font-semibold rounded-lg">
                      View Property
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}



      {/* CTA Section - Dark Purple Style */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 py-20 lg:py-28 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-500 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500 rounded-full blur-3xl" />
        </div>

        <div className="max-w-5xl mx-auto px-4 text-center relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-6">
              Discover More <span className="bg-gradient-to-r from-orange-400 to-orange-300 bg-clip-text text-transparent">Exclusive Properties</span>
            </h2>
            <p className="text-xl lg:text-2xl text-slate-300 mb-4 leading-relaxed">
              Validate property prices with real buyer feedback
            </p>
            <p className="text-lg text-slate-400 mb-10">
              100% free to browse • No hidden fees • Share opinions, register interest
            </p>

            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <motion.a
                href="/listings"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.98 }}
                className="inline-flex items-center justify-center px-10 py-5 text-xl font-bold text-slate-900 bg-gradient-to-r from-orange-400 to-orange-300 rounded-lg shadow-2xl shadow-orange-500/30 hover:shadow-orange-500/50 transition-all duration-300"
              >
                <svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Browse All Properties
              </motion.a>
              <motion.button
                onClick={() => setShowSignupModal(true)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.98 }}
                className="inline-flex items-center justify-center px-10 py-5 text-xl font-bold text-white bg-white/10 border-2 border-white/20 rounded-lg hover:bg-white/20 transition-all duration-300 backdrop-blur-sm"
              >
                <svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                Get Notified of New Properties
              </motion.button>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Footer */}
      <AgentFooter />

      {/* Sticky Price Opinion Bar */}
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{
          y: showStickyPrice ? 0 : 100,
          opacity: showStickyPrice ? 1 : 0
        }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none"
      >
        <div className="max-w-7xl mx-auto px-4 pb-4">
          <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-2xl shadow-2xl border border-slate-700 pointer-events-auto">
            <div className="px-4 sm:px-6 py-4">
              {/* Mobile Layout */}
              <div className="flex flex-col gap-3 sm:hidden">
                <div className="flex items-center justify-between">
                  <span className="text-white/80 text-sm font-medium">Your Price Opinion</span>
                  <motion.span
                    key={priceOpinion}
                    initial={{ scale: 1.1 }}
                    animate={{ scale: 1 }}
                    className="text-2xl font-bold text-orange-400"
                  >
                    {formatMoney(priceOpinion)}
                  </motion.span>
                </div>
                <PriceOpinionSlider
                  min={minPrice}
                  max={maxPrice}
                  value={priceOpinion}
                  onChange={setPriceOpinion}
                  onSlideStart={() => setIsSliding(true)}
                  onSlideEnd={() => setIsSliding(false)}
                  className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer sticky-slider"
                />
                <div className="flex justify-between text-xs text-slate-500">
                  <span>{formatCompact(minPrice)}</span>
                  <span>{formatCompact(maxPrice)}</span>
                </div>
                <button
                  onClick={handleRegisterInterest}
                  className="w-full bg-gradient-to-r from-[var(--brand-primary,#e48900)] to-[var(--brand-primary-dark,#c64500)] text-white font-bold py-3 rounded-xl"
                >
                  Register Interest
                </button>
              </div>

              {/* Desktop Layout */}
              <div className="hidden sm:flex items-center gap-6">
                <div className="flex-shrink-0">
                  <span className="text-white/80 text-sm font-medium block mb-1">Your Price Opinion</span>
                  <motion.span
                    key={priceOpinion}
                    initial={{ scale: 1.1 }}
                    animate={{ scale: 1 }}
                    className="text-3xl font-bold text-orange-400"
                  >
                    {formatMoney(priceOpinion)}
                  </motion.span>
                </div>

                <div className="flex-1 px-4">
                  <PriceOpinionSlider
                    min={minPrice}
                    max={maxPrice}
                    value={priceOpinion}
                    onChange={setPriceOpinion}
                    onSlideStart={() => setIsSliding(true)}
                    onSlideEnd={() => setIsSliding(false)}
                    className="w-full h-3 bg-slate-700 rounded-lg appearance-none cursor-pointer sticky-slider"
                  />
                  <div className="flex justify-between mt-1 text-xs text-slate-500">
                    <span>{formatCompact(minPrice)}</span>
                    <span>{formatCompact(maxPrice)}</span>
                  </div>
                </div>

                <motion.button
                  onClick={handleRegisterInterest}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.98 }}
                  className="flex-shrink-0 bg-gradient-to-r from-[var(--brand-primary,#e48900)] to-[var(--brand-primary-dark,#c64500)] text-white font-bold px-6 py-3 rounded-xl shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 transition-all"
                >
                  Register Interest
                </motion.button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {confirmOpinionModal}

      {/* Price Opinion Modal */}
      {showPriceOpinionModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-8 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowPriceOpinionModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="text-center mb-6">
              <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-10 h-10 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-3xl font-bold text-slate-800 mb-3">
                Opinion Saved!
              </h3>
              <div className="text-5xl font-bold text-orange-600 mb-4">
                {formatMoney(priceOpinion)}
              </div>
              <p className="text-slate-600 mb-6">
                You've left a price opinion for this property
              </p>
            </div>

            {/* Two Options Side by Side */}
            <div className="space-y-4">
              {/* Primary: Register Interest */}
              <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-xl p-6 border-2 border-orange-200">
                <h4 className="font-bold text-lg text-slate-800 mb-2">
                  Seriously Interested in This Property?
                </h4>
                <p className="text-sm text-slate-600 mb-4">
                  Register your interest and let the agent know you&apos;re serious about this property
                </p>
                <button
                  onClick={handleRegisterInterest}
                  className="w-full bg-gradient-to-r from-[var(--brand-primary,#e48900)] to-[var(--brand-primary-dark,#c64500)] text-white font-bold py-4 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  Register My Interest
                </button>
              </div>

              {/* Secondary: Continue Browsing */}
              <button
                onClick={() => setShowPriceOpinionModal(false)}
                className="w-full py-3 text-slate-600 hover:text-slate-900 font-medium transition-colors"
              >
                Continue Browsing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Qualification Modal */}
      {showQualificationModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => {
                setShowQualificationModal(false);
                setRegisterInterest(false);
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-slate-800 mb-2">
                You Expressed Your Interest
              </h3>
              <p className="text-slate-600">
                Help us understand your circumstance to better facilitate
              </p>
            </div>

            <div className="space-y-6">
              {/* First Home Buyer Toggle */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm font-semibold text-slate-800">
                    Are you a first home buyer?
                  </span>
                  <input
                    type="checkbox"
                    checked={qualificationData.isFirstHomeBuyer}
                    onChange={(e) => setQualificationData({
                      ...qualificationData,
                      isFirstHomeBuyer: e.target.checked
                    })}
                    className="w-5 h-5 text-orange-600 rounded focus:ring-2 focus:ring-orange-500"
                  />
                </label>
              </div>

              {/* Investor Toggle */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm font-semibold text-slate-800">
                    Are you an investor?
                  </span>
                  <input
                    type="checkbox"
                    checked={qualificationData.isInvestor}
                    onChange={(e) => setQualificationData({
                      ...qualificationData,
                      isInvestor: e.target.checked
                    })}
                    className="w-5 h-5 text-orange-600 rounded focus:ring-2 focus:ring-orange-500"
                  />
                </label>
              </div>

              {/* Buyer Type */}
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-3">
                  Are you a cash buyer or have approved finance? *
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

              {/* Seriousness Level */}
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-3">
                  How serious are you about this property? *
                </label>
                <select
                  value={qualificationData.seriousnessLevel}
                  onChange={(e) => setQualificationData({
                    ...qualificationData,
                    seriousnessLevel: e.target.value
                  })}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all text-slate-800"
                >
                  <option value="">Select your interest level</option>
                  <option value="just_browsing">Just Browsing</option>
                  <option value="interested">Interested</option>
                  <option value="very_interested">Very Interested</option>
                  <option value="ready_to_buy">Ready to Buy</option>
                </select>
              </div>

              {/* Continue Button */}
              <button
                onClick={handleQualificationSubmit}
                disabled={!qualificationData.buyerType || !qualificationData.seriousnessLevel}
                className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-4 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Continue</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Signup Modal */}
      {showSignupModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => {
                setShowSignupModal(false);
                setShowThankYou(false);
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {showThankYou ? (
              <div className="text-center">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-3xl font-bold text-slate-800 mb-3">
                  You're All Set!
                </h3>
                <p className="text-lg text-slate-600 mb-6">
                  Your interest in this property has been registered.
                </p>

                <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-xl p-6 mb-6 border border-orange-200">
                  <h4 className="font-bold text-slate-800 mb-2">What Happens Next?</h4>
                  <ul className="text-sm text-slate-700 text-left space-y-2">
                    <li className="flex items-start gap-2">
                      <svg className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      We'll notify you when this property goes to market
                    </li>
                    <li className="flex items-start gap-2">
                      <svg className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      You'll receive alerts for matching properties in your area
                    </li>
                    <li className="flex items-start gap-2">
                      <svg className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Access to exclusive pre-market properties - 100% free
                    </li>
                  </ul>
                </div>

                <a
                  href="/listings"
                  className="inline-flex items-center justify-center w-full px-6 py-4 bg-gradient-to-r from-[var(--brand-primary,#e48900)] to-[var(--brand-primary-dark,#c64500)] text-white font-bold rounded-xl hover:shadow-lg transition-all"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Browse More Properties
                </a>
              </div>
            ) : (
              <>
                <div className="text-center mb-6">
                  <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                  </div>
                  <h3 className="text-2xl font-bold text-slate-800 mb-2">
                    Register Your Interest
                  </h3>
                  <p className="text-slate-600">
                    Enter your details so the agent can get in touch
                  </p>
                </div>

                <form onSubmit={handleContactSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        First Name
                      </label>
                      <input
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        required
                        className="text-gray-900 placeholder-gray-300 w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
                        placeholder="John"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Last Name
                      </label>
                      <input
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        required
                        className="text-gray-900 placeholder-gray-300 w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
                        placeholder="Doe"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Email
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="text-gray-900 placeholder-gray-300 w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
                      placeholder="john@example.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Phone
                    </label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                      className="text-gray-900 placeholder-gray-300 w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
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
                    className="w-full bg-gradient-to-r from-[var(--brand-primary,#e48900)] to-[var(--brand-primary-dark,#c64500)] text-white font-bold py-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? 'Submitting...' : 'Register Interest'}
                  </button>
                </form>

                <p className="text-xs text-center text-slate-500 mt-4">
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
          {/* Close Button */}
          <button
            onClick={closeLightbox}
            className="absolute top-4 right-4 z-10 w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors"
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Image Counter */}
          <div className="absolute top-4 left-4 z-10 bg-black/50 text-white px-4 py-2 rounded-full text-sm font-semibold">
            {currentImageIndex + 1} / {imageUrls.length}
          </div>

          {/* Previous Button */}
          {imageUrls.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                prevImage();
              }}
              className="absolute left-4 z-10 w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors"
            >
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          {/* Image */}
          <div 
            className="relative max-w-7xl max-h-[90vh] w-full h-full flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={imageUrls[currentImageIndex]}
              alt={`${title} - Image ${currentImageIndex + 1}`}
              width={1200}
              height={800}
              className="max-w-full max-h-full object-contain"
              unoptimized
            />
          </div>

          {/* Next Button */}
          {imageUrls.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                nextImage();
              }}
              className="absolute right-4 z-10 w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors"
            >
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}

          {/* Thumbnail Strip */}
          {imageUrls.length > 1 && (
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10 flex gap-2 bg-black/50 p-3 rounded-full max-w-[90vw] overflow-x-auto">
              {imageUrls.map((url, index) => (
                <div
                  key={index}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentImageIndex(index);
                  }}
                  className={`relative w-16 h-16 rounded-lg overflow-hidden cursor-pointer flex-shrink-0 transition-all ${
                    index === currentImageIndex ? 'ring-2 ring-white scale-110' : 'opacity-60 hover:opacity-100'
                  }`}
                >
                  <Image
                    src={url}
                    alt={`Thumbnail ${index + 1}`}
                    fill
                    className="object-cover"
                    unoptimized
                  />
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
          onMouseDown={(e) => { if (e.target === e.currentTarget) setVideoModalOpen(false); }}
        >
          {/* Close Button */}
          <button
            onClick={() => setVideoModalOpen(false)}
            className="absolute top-4 right-4 z-10 w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors"
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div
            className="relative w-full max-w-5xl mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <video
              src={displayVideoUrl}
              controls
              autoPlay
              playsInline
              className="w-full rounded-xl"
              style={{ maxHeight: '85vh' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}