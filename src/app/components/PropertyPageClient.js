'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { getAuth } from 'firebase/auth';
import { useAuth } from '../context/AuthContext';
import { fetchAgentProfiles } from '../utils/fetchAgentProfiles';
import { shouldLinkAccount } from '../utils/registrationIdentity';
import { db } from '../firebase/clientApp';
import { doc, getDoc, addDoc, collection, serverTimestamp, updateDoc, deleteField } from 'firebase/firestore';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { usePropertyEngagement } from '../hooks/usePropertyEngagement';
import PriceOpinionSlider, { roundToStep } from './PriceOpinionSlider';
import { computeBrandStyle, computeDisplayLogoUrl, computeEffectiveColors, applyOfficeBrand } from '../utils/brandStyle';
import { getMarketStatusCopy } from '../utils/marketStatusCopy';
import { isPreviewDeployment } from '../utils/previewEnvironment';
import { getSwipeDirection } from '../utils/swipeGesture';
import { computePriceOpinionRange } from '../utils/priceOpinionRange';
import { shouldShowPersistentSlider } from '../utils/persistentSliderVisibility';
import PreviewModeBanner from './property-page/PreviewModeBanner';
import OpenHomeKiosk from './kiosk/OpenHomeKiosk';
import { playfairDisplay } from './property-page/fonts';
import PropertyHeader from './property-page/PropertyHeader';
import PropertyHero from './property-page/PropertyHero';
import PriceOpinionCard from './property-page/PriceOpinionCard';
import PropertyInfoCard from './property-page/PropertyInfoCard';
import PropertyGallery from './property-page/PropertyGallery';
import AgentSignOff from './property-page/AgentSignOff';
import PersistentValuationBar from './property-page/PersistentValuationBar';

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

// Register-interest "what would you like next?" — always answered (default
// 'contact'), never a gate; replaces the old "how serious are you about this
// property?" question, which was stored but never actually changed anything
// the agent saw. An action an agent can act on beats a self-rated adjective.
const NEXT_ACTION_OPTIONS = [
  { value: 'contact', label: 'Have the agent contact me' },
  { value: 'inspection', label: 'Arrange an inspection' },
  { value: 'info', label: 'Send me more information' },
];

// Optional, inside the collapsed "more details" section — more useful to an
// agent for triage than a vague seriousness rating, and never required.
const TIMEFRAME_OPTIONS = [
  { value: 'asap', label: 'ASAP' },
  { value: '1_3_months', label: '1–3 months' },
  { value: '3_6_months', label: '3–6 months' },
  { value: '6_12_months', label: '6–12+ months' },
  { value: 'just_exploring', label: 'Just exploring' },
];

// Optional, inside the collapsed "more details" section. Asking this before
// a buyer has even given their name — as the old qualification modal did,
// as a mandatory field — is backwards: it's personal financial information
// requested ahead of any stated intent, gatekeeping a low-friction action.
const FINANCE_OPTIONS = [
  { value: 'cash', label: 'Cash Buyer' },
  { value: 'approved_finance', label: 'Approved Finance' },
  { value: 'pre_approval', label: 'Pre-Approval' },
  { value: 'not_yet', label: 'Not Yet' },
];

export default function PropertyPageClient({ previewBrand, previewPropertyId, initialProperty } = {}) {
  const searchParams = useSearchParams();
  const propertyId = previewPropertyId || searchParams.get('propertyId');
  const initialMode = searchParams.get('mode');
  const auth = getAuth();
  const { user: currentAuthUser } = useAuth();

  const [isIpadMode, setIsIpadMode] = useState(initialMode === 'ipad');

  const [showQualificationModal, setShowQualificationModal] = useState(false);
  // The web register-interest flow asks nextAction/timeframe (below); the old
  // "how serious are you" question never changed what the agent received. The
  // iPad open-home mode has its own one-page flow (components/kiosk/OpenHomeKiosk.js).
  const [qualificationData, setQualificationData] = useState({
    isFirstHomeBuyer: false,
    isInvestor: false,
    buyerType: '',
    seriousnessLevel: '',
    nextAction: 'contact',
    timeframe: '',
  });
  // Collapsed by default — everything inside is optional enrichment, never
  // a gate in front of the three fields (name/email/phone) that actually
  // make a lead actionable.
  const [showMoreDetails, setShowMoreDetails] = useState(false);

  // Seeded from the server-fetched property (see find-property/page.js)
  // when available, so the first paint has real content instead of a
  // spinner. The fetchProperty effect below still runs unconditionally
  // afterwards and is the one that actually drives views/sessions/
  // opinion-prefill — this prop only short-circuits the visible wait,
  // it changes nothing about when those side effects fire.
  const [property, setProperty] = useState(initialProperty || null);
  const [loading, setLoading] = useState(!initialProperty);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [videoModalOpen, setVideoModalOpen] = useState(false);

  // Price opinion state. min/maxPrice are seeded alongside
  // initialProperty (not left at 0) so the opinion card never has a
  // moment of showing a broken 0–0 range before the fetchProperty
  // effect's own computation catches up. priceOpinion itself used to be
  // left at a bare 0 here — since both sliders clamp an out-of-range
  // value to `min` for display, that meant the very first paint showed
  // the thumb pinned at the minimum, then visibly jumping to the
  // midpoint once fetchPreviousOffer resolved a moment later. Seeding it
  // to the midpoint up front (same initialRange this is already derived
  // from) means the first frame is already correct — no animation to
  // suppress, because there's no longer a wrong frame to move away from.
  // hasInteracted (below) still starts false regardless, so this seeded
  // midpoint is never shown as a price or submittable until a real drag.
  const initialRange = initialProperty ? computePriceOpinionRange(initialProperty) : null;
  const [priceOpinion, setPriceOpinion] = useState(
    initialRange ? roundToStep((initialRange.min + initialRange.max) / 2) : 0
  );
  const [minPrice, setMinPrice] = useState(initialRange?.min || 0);
  const [maxPrice, setMaxPrice] = useState(initialRange?.max || 0);
  // Whether this visitor has ever deliberately moved the slider for this
  // property — true immediately for a returning visitor whose prior
  // opinion was restored. The slider's starting position is no longer
  // anchored on the asking price; this is what gates the price display
  // and Submit button until a real drag has happened. See
  // PriceOpinionCard.js.
  const [hasInteracted, setHasInteracted] = useState(false);
  const [showPriceOpinionModal, setShowPriceOpinionModal] = useState(false);
  const [showConfirmOpinionModal, setShowConfirmOpinionModal] = useState(false);
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [registerInterest, setRegisterInterest] = useState(false);
  const [savedOfferId, setSavedOfferId] = useState(null);
  // How many opinions (including this one) exist for this property —
  // fetched once, right after a successful save, to give the "Opinion
  // saved" modal a genuine, privacy-safe participation count instead of
  // an empty confirmation. See api/offers/opinion-count/route.js for
  // exactly why this is a count only, never an average or a range.
  const [opinionCount, setOpinionCount] = useState(null);
  const [isSliding, setIsSliding] = useState(false);
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

  const firstInteractionTracked = useRef(false);

  // Engagement tracking (view duration, scroll depth, photos, shares, opinions)
  const {
    trackPhotoView,
    trackShare,
    trackOpinionStart,
    trackSubmitAttempted,
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

  const confirmPriceOpinion = () => {
    setShowConfirmOpinionModal(false);
    savePriceOpinion();
  };

  // The buyer's first genuine touch of the slider — not mount, not a
  // restored prior value, not submit time. This is what actually
  // unlocks the price display/Submit button (see hasInteracted), and
  // the correctly-timed "first price interaction" funnel signal that
  // trackOpinionStart used to fire at submit time instead (see
  // engagement-ping/route.js for why that distinction matters).
  const handleSlideStart = () => {
    setIsSliding(true);
    if (!firstInteractionTracked.current) {
      firstInteractionTracked.current = true;
      setHasInteracted(true);
      trackOpinionStart();
      trackEvent('price_interaction_started', { property_id: propertyId });
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
          const { min, max } = computePriceOpinionRange(data);
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
        const profiles = await fetchAgentProfiles([property.userId]);
        const userData = profiles[property.userId];
        if (userData) {
          const data = {
            firstName: userData.firstName,
            lastName: userData.lastName,
            companyName: userData.companyName,
            avatar: userData.avatar,
            logoUrl: userData.logoUrl,
            brandColors: userData.brandColors,
            officeId: userData.officeId || null,
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

          // Resolve which shared brand (if any) applies. An office
          // member's brand is looked up via their office — never via
          // their own agencyBrandId, which office members never have
          // set — so that an office-wide branding change, or removing
          // this agent from the office, takes effect immediately with
          // nothing to clean up (see brandProfileService.js's
          // resolveBrandIdForUser, which this mirrors for the public
          // page's own direct Firestore reads). An independent agent's
          // brand comes from their own agencyBrandId exactly as before
          // office support existed. Agency branding is entirely
          // optional either way — if nothing resolves, or the linked
          // brand can't be read for any reason, `brand` simply stays
          // null and every colour on this page falls back to the
          // existing default theme.
          let brandId = userData.agencyBrandId || null;
          if (userData.officeId) {
            try {
              const officeDoc = await getDoc(doc(db, 'offices', userData.officeId));
              brandId = officeDoc.exists() ? (officeDoc.data().agencyBrandId || null) : null;
            } catch (err) {
              console.error('Error fetching office (non-fatal):', err);
              brandId = null;
            }
          }
          if (brandId) {
            try {
              const brandDoc = await getDoc(doc(db, 'agencyBrands', brandId));
              if (brandDoc.exists()) {
                const resolvedBrand = { id: brandDoc.id, ...brandDoc.data() };
                setBrand(resolvedBrand);
                // Office-linked agents: the office's master brand is
                // authoritative (logo, agency name, colours) over any
                // personal values on their own user doc.
                if (data.officeId) setAgentData(applyOfficeBrand(data, resolvedBrand));
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
        // Restoring a genuine prior answer is not the same as an
        // untouched default — this visitor already deliberately gave
        // an opinion, so there's nothing to re-invite.
        setHasInteracted(true);
        return;
      }

      // No prior opinion: the slider still needs a sensible starting
      // position for the thumb to render at, so it's seeded at the
      // midpoint — but hasInteracted stays false, so this number is
      // never shown or submittable until the visitor actually drags.
      const mid = roundToStep((min + max) / 2);
      setPriceOpinion(mid);
    } catch (error) {
      console.error('Error fetching previous offer:', error);
      const mid = roundToStep((min + max) / 2);
      setPriceOpinion(mid);
    }
  };

  // Real, privacy-safe count of opinions on this property — see
  // api/offers/opinion-count/route.js for exactly what it does and
  // doesn't reveal. Never blocks the save path; a failed fetch just
  // means the modal skips the participation line.
  const fetchOpinionCount = async () => {
    try {
      const res = await fetch(`/api/offers/opinion-count?propertyId=${encodeURIComponent(propertyId)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data.count === 'number') setOpinionCount(data.count);
    } catch (error) {
      console.error('Error fetching opinion count:', error);
    }
  };

  const savePriceOpinion = async () => {
    // Fires the instant a submit is attempted, before the write resolves
    // — distinct from trackOpinionComplete below, so "attempted" and
    // "succeeded" can be told apart (see engagement-ping/route.js).
    trackSubmitAttempted();
    trackEvent('opinion_submit_attempted', {
      property_id: propertyId,
      opinion_amount: Math.round(priceOpinion),
    });

    // Preview deployments connect to the real production Firestore project
    // (see utils/previewEnvironment.js) — simulate a successful save so the
    // full UX can be tested, without writing a real buyer opinion. Analytics
    // events above/below are intentionally still fired so tracking behaviour
    // itself can be verified in preview too.
    if (isPreviewDeployment()) {
      trackOpinionComplete();
      await fetchOpinionCount();
      setShowPriceOpinionModal(true);
      return;
    }
    try {
      const sessionId = getSessionId();
      // Same persistent, anonymous identifier already used for views and
      // meaningful sessions (see incrementPropertyViews) — stamped onto
      // the offer as an additive field so the opinion-conversion funnel
      // can eventually be joined across those collections.
      const visitorId = localStorage.getItem('pm_visitor_id') || null;

      const offerData = {
        type: 'opinion',
        propertyId: propertyId,
        sessionId: sessionId,
        visitorId,
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
      await fetchOpinionCount();
      // Show the modal
      setShowPriceOpinionModal(true);
    } catch (error) {
      console.error('Error saving price opinion:', error);
    }
  };

  // Explicit en-AU/AUD formatting rather than a bare `$` + toLocaleString()
  // concatenation — that relied on the runtime's default locale for digit
  // grouping, which is fine on most servers but not guaranteed.
  const formatMoney = (val) => {
    if (!val) return '$0';
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const formatCompact = (val) => {
    if (!val) return '$0';
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(val);
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

    const linkAccount = !!currentAuthUser
      && shouldLinkAccount({ typedEmail: email, accountEmail: currentAuthUser.email });

    try {
      const interestFields = {
        serious: registerInterest && hasAllContactFields ? true : false,
        isFirstHomeBuyer: qualificationData.isFirstHomeBuyer,
        isInvestor: qualificationData.isInvestor,
        buyerType: qualificationData.buyerType || null,
        nextAction: qualificationData.nextAction,
        timeframe: qualificationData.timeframe || null,
        buyerName: `${firstName.trim()} ${lastName.trim()}`.trim(),
        buyerEmail: email.trim().toLowerCase() || null,
        buyerPhone: phone.trim() || null,
        // Link the signed-in account ONLY when the typed email is that account's
        // own. An agent or office admin who is logged in while registering
        // someone else's details must not have the registration attributed to
        // them (their profile would replace the buyer in reports, dashboards
        // and emails). Otherwise the typed details stand alone.
        ...(linkAccount ? { userId: currentAuthUser.uid } : {}),
        updatedAt: serverTimestamp(),
      };

      let targetOfferId = savedOfferId;

      // Preview deployments share production Firestore (see
      // utils/previewEnvironment.js) — never write a real registered-interest
      // record, or notify a real agent, from a preview build.
      if (!isPreviewDeployment()) {
        if (savedOfferId) {
          await updateDoc(doc(db, 'offers', savedOfferId), {
            ...interestFields,
            // If this page session already linked the offer to the signed-in
            // account (an earlier submit with their own email), unlink it now
            // that different buyer details were entered.
            ...(currentAuthUser && !linkAccount ? { userId: deleteField() } : {}),
          });
        } else {
          // No prior price opinion exists for this visitor — this used to
          // mean registering interest silently wrote nothing at all (the
          // whole updateDoc call was skipped, with no fallback) while the
          // UI still showed success. Registering interest must always
          // create a genuine lead, whether or not this visitor ever
          // touched the valuation slider. type stays 'opinion' so this
          // flows through the existing dashboard/reporting pipeline
          // unchanged; offerAmount is only ever included if this visitor
          // actually gave a real opinion (hasInteracted) — never
          // fabricated for someone who went straight to registering
          // interest.
          const sessionId = getSessionId();
          const visitorId = localStorage.getItem('pm_visitor_id') || null;
          const docRef = await addDoc(collection(db, 'offers'), {
            type: 'opinion',
            propertyId,
            sessionId,
            visitorId,
            fromWeb: true,
            createdAt: serverTimestamp(),
            ...(hasInteracted ? { offerAmount: Math.round(priceOpinion) } : {}),
            ...interestFields,
          });
          targetOfferId = docRef.id;
          setSavedOfferId(docRef.id);
        }
      }

      trackEvent('registered_interest', {
        property_id: propertyId,
        registered_interest: registerInterest,
        has_account: !!currentAuthUser,
        had_prior_opinion: !!savedOfferId,
      });

      // Fire-and-forget — the agent notification is a nice-to-have on top
      // of a successful registration, never a reason to block or fail the
      // buyer's own confirmation if it doesn't go through.
      if (!isPreviewDeployment() && targetOfferId) {
        fetch('/api/offers/notify-interest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offerId: targetOfferId, propertyId }),
        }).catch((err) => console.error('Error notifying agent of new interest:', err));
      }

      setShowThankYou(true);
    } catch (error) {
      console.error('Register interest error:', error);
      setSignupError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Goes straight to the single contact-details form — no separate
  // qualification screen first. The old two-modal flow asked finance
  // status and a "how serious are you" rating before a buyer could even
  // give their name; neither is worth gating lead capture behind, so
  // registering interest now only ever asks for what it actually needs
  // up front, with everything else folded into an optional section inside
  // that one form (see showMoreDetails / the Register Interest modal).
  const handleRegisterInterest = () => {
    setRegisterInterest(true);
    setShowPriceOpinionModal(false);
    setShowMoreDetails(false);
    setShowSignupModal(true);

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
  // when there's neither a personal override nor a linked shared brand,
  // so every var(--brand-x, <default>) reference throughout this
  // component and PriceOpinionSlider.js falls through to the exact
  // existing Premarket colours unchanged. The agent's own personal
  // logo/colour override (agentData.logoUrl / .brandColors) always wins
  // over the shared brand — see brandStyle.js's own comment for why.
  // previewBrand (dashboard-only) lets the branding setup page render
  // this exact same component with proposed, not-yet-saved colours, so
  // agents see precisely what buyers will see before confirming
  // anything — it takes absolute precedence over both when present.
  const effectiveColors = computeEffectiveColors({ brand, agentData, previewBrand });
  const brandStyle = computeBrandStyle(effectiveColors);
  const displayLogoUrl = computeDisplayLogoUrl({ brand, agentData, previewBrand });

  // ═══════════════════════════════════════════════════════════════
  // iPad Open Home Mode - one full-screen page (see components/kiosk/OpenHomeKiosk.js).
  // `&demo=1` runs the full flow with nothing saved or sent, on any host — handy
  // for reviewing the design without creating live opinions or registrations.
  // ═══════════════════════════════════════════════════════════════
  if (isIpadMode) {
    return (
      <OpenHomeKiosk
        propertyId={propertyId}
        title={title}
        addressLine={property?.showSuburbOnly ? (address || 'Suburb') : (formattedAddress || address)}
        imageUrl={imageUrls[0]}
        agentName={[agentData?.firstName, agentData?.lastName].filter(Boolean).join(' ')}
        companyName={agentData?.companyName}
        logoUrl={displayLogoUrl}
        avatarUrl={agentData?.avatar}
        brandStyle={brandStyle}
        minPrice={minPrice}
        maxPrice={maxPrice}
        demoMode={isPreviewDeployment() || searchParams.get('demo') === '1'}
        getVisitorId={() => { try { return localStorage.getItem('pm_visitor_id'); } catch { return null; } }}
        onExit={() => setIsIpadMode(false)}
        onOpinionPersisted={() => {
          incrementPropertyViews(propertyId);
          trackEvent('ipad_price_opinion_created', { property_id: propertyId });
        }}
        onRegistrationPersisted={() => trackEvent('ipad_registered_interest', { property_id: propertyId })}
      />
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
          Your anonymous feedback
        </p>
        <div className="text-4xl sm:text-5xl font-semibold text-[var(--brand-primary,#c2410c)] mb-6 tabular-nums">
          {formatMoney(priceOpinion)}
        </div>
        <h3 className="text-lg font-semibold text-slate-900 mb-2">
          Confirm your feedback?
        </h3>
        <p className="text-sm text-slate-500 mb-8">
          No signup required — your response stays anonymous. It&rsquo;s not an offer to purchase.
        </p>
        <div className="space-y-3">
          <button
            onClick={confirmPriceOpinion}
            className="w-full bg-[var(--brand-primary,#c2410c)] hover:opacity-90 text-[var(--brand-text-on-primary,#ffffff)] font-semibold py-3.5 rounded-xl transition-opacity"
          >
            Yes, confirm my feedback
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
        // Optional — only set for a property whose agent used the new
        // positioning step on the cover photo, stored as a ready-to-use
        // CSS object-position value ("x% y%"). Every property that
        // predates this feature (or whose agent never touched it) has
        // no heroFocalPoint at all, so this is undefined and the hero
        // renders exactly as it always has: centred object-cover.
        heroFocalPoint={property?.heroFocalPoint || undefined}
        hasVideo={!!displayVideoUrl}
        onWatchVideo={() => setVideoModalOpen(true)}
      />

      {/*
        pb- here is deliberately larger than pt- (and larger on mobile
        than sm:) to reserve room at the bottom of the page content for
        the always-on fixed valuation bar below, which floats over
        whatever is at the bottom of the viewport — without this, the
        map/agent sign-off could end up permanently hidden behind it.
      */}
      <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-10 sm:pt-16 pb-32 sm:pb-24">
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
          <div className="h-full">
            <PriceOpinionCard
              propertyId={propertyId}
              priceOpinion={priceOpinion}
              minPrice={minPrice}
              maxPrice={maxPrice}
              hasInteracted={hasInteracted}
              isSliding={isSliding}
              onChange={setPriceOpinion}
              onSlideStart={handleSlideStart}
              onSlideEnd={() => setIsSliding(false)}
              onSubmitOpinion={openConfirmOpinion}
              onRegisterInterest={handleRegisterInterest}
              formatMoney={formatMoney}
              formatCompact={formatCompact}
              heading={marketCopy.priceOpinionHeading}
              interestSubcopy={marketCopy.interestSubcopy}
            />
          </div>
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

      <PersistentValuationBar
        visible={shouldShowPersistentSlider({
          anyModalOpen: showConfirmOpinionModal || showPriceOpinionModal || showQualificationModal || showSignupModal || lightboxOpen || videoModalOpen,
          hasSubmittedOpinion: !!savedOfferId,
        })}
        priceOpinion={priceOpinion}
        hasInteracted={hasInteracted}
        isSliding={isSliding}
        minPrice={minPrice}
        maxPrice={maxPrice}
        onChange={setPriceOpinion}
        onSlideStart={handleSlideStart}
        onSlideEnd={() => setIsSliding(false)}
        onSubmit={openConfirmOpinion}
        formatMoney={formatMoney}
        formatCompact={formatCompact}
      />

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
                Your opinion&rsquo;s locked in
              </h3>
              <div className="text-4xl font-semibold text-[var(--brand-primary,#c2410c)] mb-4 tabular-nums">
                {formatMoney(priceOpinion)}
              </div>
              <p className="text-slate-500 mb-1 text-sm">
                This is your honest opinion of the property&rsquo;s value &mdash; not an offer or a commitment to buy.
              </p>
              {typeof opinionCount === 'number' && opinionCount > 0 && (
                <p className="text-slate-400 text-xs mt-3">
                  {opinionCount === 1
                    ? 'You’re the first to share an opinion on this property.'
                    : `${opinionCount.toLocaleString()} opinions shared on this property so far.`}
                </p>
              )}
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

      {/*
        Register Interest Modal — a single screen, replacing the old
        qualification-then-contact two-modal flow. Name/email/phone are the
        only things that make this a usable lead, so they're the only
        mandatory fields; the next-action choice always has a sensible
        default so it can never block submission; everything else (finance,
        timeframe, FHB/investor) lives in a collapsed, explicitly optional
        section underneath, never gating the fields above it.
      */}
      {showSignupModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowSignupModal(false)}
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
                  {agentData?.firstName
                    ? `${agentData.firstName} now has your details and will be in touch.`
                    : 'The agent now has your details and will be in touch.'}
                </p>
                {/* There's no public browsing page to send a buyer to
                    anymore — properties are reached through their own
                    shareable link. Closing just reveals the same property
                    page underneath, registration intact; reopening this
                    modal later (see the close button above) shows this
                    same confirmation again rather than the form. */}
                <button
                  type="button"
                  onClick={() => setShowSignupModal(false)}
                  className="inline-flex items-center justify-center w-full px-6 py-3.5 bg-[var(--brand-primary,#c2410c)] hover:opacity-90 text-[var(--brand-text-on-primary,#ffffff)] font-semibold rounded-xl transition-opacity"
                >
                  Back to Property
                </button>
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

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      What would you like next?
                    </label>
                    <div className="space-y-2">
                      {NEXT_ACTION_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setQualificationData({
                            ...qualificationData,
                            nextAction: option.value
                          })}
                          className={`w-full text-left px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                            qualificationData.nextAction === option.value
                              ? 'border-slate-800 bg-slate-900 text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowMoreDetails(!showMoreDetails)}
                    className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors underline underline-offset-2"
                  >
                    {showMoreDetails ? 'Hide extra details' : 'Add a few more details (optional)'}
                  </button>

                  {showMoreDetails && (
                    <div className="space-y-4 pt-1">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          When are you hoping to buy?
                        </label>
                        <select
                          value={qualificationData.timeframe}
                          onChange={(e) => setQualificationData({
                            ...qualificationData,
                            timeframe: e.target.value
                          })}
                          className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-400 focus:border-transparent outline-none transition-all text-slate-800"
                        >
                          <option value="">Prefer not to say</option>
                          {TIMEFRAME_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                          Where are you up to with finance? <span className="text-slate-400 font-normal">(optional)</span>
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                          {FINANCE_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setQualificationData({
                                ...qualificationData,
                                buyerType: qualificationData.buyerType === option.value ? '' : option.value
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
                    </div>
                  )}

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
                    {submitting ? 'Submitting...' : 'Register my interest'}
                  </button>
                </form>

                <p className="text-xs text-center text-slate-400 mt-4">
                  Your details will be shared with the agent for this property so they can follow up. This isn&rsquo;t an offer or a commitment to buy.
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
          onMouseDown={(e) => { if (e.target === e.currentTarget) setVideoModalOpen(false); }}
        >
          <button
            onClick={() => setVideoModalOpen(false)}
            className="absolute top-4 right-4 z-10 w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors"
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="relative w-full max-w-5xl mx-4" onClick={(e) => e.stopPropagation()}>
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
