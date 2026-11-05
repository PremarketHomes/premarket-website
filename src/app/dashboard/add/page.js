'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import { useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import { authFetch } from '../../utils/authFetch';
import { useRequireAgent } from '../../hooks/useRequireAgent';
import { db, storage } from '../../firebase/clientApp';
import { useJsApiLoader, Autocomplete } from '@react-google-maps/api';
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
  setDoc,
  getDoc,
  getDocs,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import ImagePositioner from '../../components/ImagePositioner';
import { cropAreaToObjectPosition } from '../../utils/imageCrop';
import {
  MapPin,
  DollarSign,
  Bed,
  Image as ImageIcon,
  Home,
  Check,
  X,
  ArrowLeft,
  ChevronRight,
  Bath,
  Car,
  Video,
  Building2,
  Search,
  Loader2,
  GripVertical,
} from 'lucide-react';
import { onSnapshot, query, where } from 'firebase/firestore';
import AgentSelector from '../../components/AgentSelector';
import AgentModal from '../../components/AgentModal';
import { pickNotificationUser } from '../../utils/notificationUser';
import { loginUrlForCurrentPage } from '../../utils/loginRedirect';

const STEPS = {
  ADDRESS: 1,
  TYPE: 2,
  PRICE: 3,
  DETAILS: 4,
  IMAGES: 5,
  TITLE: 6,
  TERMS: 7,
};

const STEP_LABELS = {
  [STEPS.ADDRESS]: 'Address',
  [STEPS.TYPE]: 'Property type',
  [STEPS.PRICE]: 'Expected price',
  [STEPS.DETAILS]: 'Details',
  [STEPS.IMAGES]: 'Media',
  [STEPS.TITLE]: 'Listing',
  [STEPS.TERMS]: 'Terms',
};

const homeTypes = ['House', 'Apartment', 'Villa', 'Townhouse', 'Acreage', 'Duplex', 'Land'];
const homeFeatures = [
  'Pool', 'Granny Flat', 'Solar', 'Air Conditioning',
  'Outdoor Entertainment Area', 'Garage / Secure Parking',
  'Study', 'Ensuite', 'Smart Home Features', 'Built-in Wardrobes',
];

const GMAPS_LIBRARIES = ['places'];

export default function AddPropertyPage() {
  useRequireAgent();
  const { user, userData, loading: authLoading } = useAuth();
  const router = useRouter();
  const autocompleteRef = useRef(null);

  const { isLoaded: mapsLoaded } = useJsApiLoader({
    id: 'gmaps-script',
    googleMapsApiKey: 'AIzaSyBbLrFWUU62O_by81ihAVKvye4bHA0sah8',
    libraries: GMAPS_LIBRARIES,
  });

  const [step, setStep] = useState(STEPS.ADDRESS);

  // Property fields
  const [formattedAddress, setFormattedAddress] = useState('');
  const [address, setAddress] = useState('');
  const [location, setLocation] = useState(null);
  const [type, setType] = useState(null);
  const [listingStatus, setListingStatus] = useState('premarket'); // 'premarket' or 'on-market'
  const [priceRaw, setPriceRaw] = useState('');
  const [bedrooms, setBedrooms] = useState('');
  const [bathrooms, setBathrooms] = useState('');
  const [carSpaces, setCarSpaces] = useState('');
  const [squareFootage, setSquareFootage] = useState('');
  const [features, setFeatures] = useState({});
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState([]);
  // CSS object-position string ("x% y%") for the cover photo, set via
  // the optional positioning step below — null until the agent uses it,
  // which is also what tells PropertyHero.js to fall back to its
  // existing centred default. Reset to null whenever the cover image
  // itself changes (removed/reordered away from index 0), since a
  // focal point chosen on one photo has no meaning on a different one.
  const [heroFocalPoint, setHeroFocalPoint] = useState(null);
  const [showHeroPositioner, setShowHeroPositioner] = useState(false);
  const [positioningHero, setPositioningHero] = useState(false);
  const [video, setVideo] = useState(null);
  const [showSuburbOnly, setShowSuburbOnly] = useState(false);

  // Terms state
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsText, setTermsText] = useState('');
  const [termsLoading, setTermsLoading] = useState(true);

  // Pricing disclosure state — fetched from the narrow public
  // pricing-info endpoint so this always matches the real configured
  // price/GST/terms rather than text that could silently drift out of
  // sync with settings/invoicing (which this page has no read access
  // to directly — see that endpoint's own comment). The initial value
  // here is a DISPLAY fallback only, shown while the real fetch is in
  // flight — it must never be trusted as a reason to allow submission;
  // pricingLoaded below is what actually gates the Submit button, so
  // a failed/slow lookup can never let an agent submit against a
  // number this page never actually confirmed with the server.
  const [pricingInfo, setPricingInfo] = useState({ pricePerListing: 200, gstRate: 0, paymentTermsDays: 14 });
  const [pricingLoaded, setPricingLoaded] = useState(false);
  const [pricingLoadFailed, setPricingLoadFailed] = useState(false);
  // Office retail pricing (display + terms only; billing is untouched).
  // 'unknown' until we know whether this agent's office shows a retail
  // price — the standard $ figure is never shown while it's unknown.
  const [retail, setRetail] = useState({ state: 'unknown', price: null, terms: '' });
  const [retailFailed, setRetailFailed] = useState(false);
  // True once the figure being shown has been confirmed by the server:
  // the office retail price, or the standard price for everyone else.
  const pricingReady = !retailFailed && (retail.state === 'retail' || (retail.state === 'none' && pricingLoaded));

  // UX state
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mediaError, setMediaError] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // Managed (office admin / team creator) creation: who the campaign is FOR. '' = myself (existing flow).
  const [assignable, setAssignable] = useState({ role: null, agents: [] });
  const [ownerUid, setOwnerUid] = useState('');
  const managedRequestId = useRef(null);

  // Agent assignment state
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [teamAgents, setTeamAgents] = useState([]);
  const [showAgentModal, setShowAgentModal] = useState(false);

  // AgentBox state
  const [agentboxConnected, setAgentboxConnected] = useState(false);
  const [showAgentboxPicker, setShowAgentboxPicker] = useState(false);
  const [abListings, setAbListings] = useState([]);
  const [abLoading, setAbLoading] = useState(false);
  const [abSearch, setAbSearch] = useState('');

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace(loginUrlForCurrentPage());
    }
  }, [user, authLoading, router]);

  // Load terms and conditions from Firestore
  useEffect(() => {
    if (!user) return;
    if (retail.state === 'unknown') return;
    if (retail.state === 'retail') {
      setTermsText(retail.terms);
      setTermsLoading(false);
      return;
    }
    const loadTerms = async () => {
      setTermsLoading(true);
      try {
        const isAgent = userData?.agent === true;
        const termsDocId = isAgent ? 'addPropertyTermsAgent' : 'addPropertyTermsVendor';
        const termsSnap = await getDoc(doc(db, 'settings', termsDocId));
        if (termsSnap.exists()) {
          const body = termsSnap.data().body || '';
          setTermsText(body.replace(/\\n/g, '\n'));
        }
      } catch (err) {
        console.error('Error loading terms:', err);
      } finally {
        setTermsLoading(false);
      }
    };
    loadTerms();
  }, [user, userData?.agent, retail.state, retail.terms]);

  // Office agents may see a retail price and matching terms instead of
  // the standard ones. Resolved server-side; a failure for an office
  // member disables submission rather than falling back to the
  // standard figure.
  const loadRetailPricing = () => {
    setRetailFailed(false);
    authFetch('/api/agents/campaign-pricing')
      .then((res) => {
        if (!res.ok) throw new Error(`campaign-pricing returned ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setRetail(data.retail
          ? { state: 'retail', price: data.price, terms: data.terms }
          : { state: 'none', price: null, terms: '' });
      })
      .catch((err) => {
        console.error('Error loading campaign pricing:', err);
        setRetailFailed(true);
      });
  };
  useEffect(() => {
    if (!user || authLoading) return;
    if (!userData?.officeId) {
      setRetail({ state: 'none', price: null, terms: '' });
      return;
    }
    loadRetailPricing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, userData?.officeId]);

  // Fetch the current campaign fee/GST/payment-terms for the pricing
  // disclosure below — a narrow public endpoint, not a direct read of
  // settings/invoicing (which this page can't read at all). Falls
  // back to the known real defaults already set as this state's
  // initial value if the fetch fails, never a broken disclosure.
  useEffect(() => {
    fetch('/api/public/pricing-info')
      .then((res) => {
        if (!res.ok) throw new Error(`pricing-info returned ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setPricingInfo((prev) => ({ ...prev, ...data }));
        setPricingLoaded(true);
      })
      .catch((err) => {
        console.error('Error loading pricing info:', err);
        // Deliberately do NOT fall back to treating the initial
        // display value as confirmed — pricingLoaded stays false, and
        // the Submit button below stays disabled until a real value
        // is confirmed or the agent retries. A silent fallback here
        // is exactly the "agent unknowingly incurs a charge" risk
        // this is meant to rule out.
        setPricingLoadFailed(true);
      });
  }, []);

  // Agents this user may create campaigns for (empty for ordinary agents, so nothing changes for them).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    authFetch('/api/properties/managed/agents')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (!cancelled && b?.agents) setAssignable(b); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user]);

  // Fetch team agents
  useEffect(() => {
    if (!user) return;
    const fetchAgents = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'agents'), where('userId', '==', user.uid)));
        setTeamAgents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Error fetching agents:', err);
      }
    };
    fetchAgents();
  }, [user]);

  // Listen for AgentBox integration status
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (snap.exists()) {
        const ab = snap.data()?.integrations?.agentbox;
        setAgentboxConnected(ab?.status === 'connected');
      }
    });
    return () => unsub();
  }, [user]);

  // Fetch AgentBox listings when picker is opened
  useEffect(() => {
    if (!showAgentboxPicker || !user || abListings.length > 0) return;
    setAbLoading(true);
    fetch(`/api/integrations/agentbox/listings?uid=${user.uid}&limit=100`)
      .then((res) => res.json())
      .then((data) => setAbListings(data.listings || []))
      .catch((err) => console.error('Failed to fetch AgentBox listings:', err))
      .finally(() => setAbLoading(false));
  }, [showAgentboxPicker, user]);

  const filteredAbListings = abListings.filter((l) => {
    if (!abSearch) return true;
    const q = abSearch.toLowerCase();
    const addr = [l.streetNumber, l.streetName, l.unitNumber, l.suburb, l.state].filter(Boolean).join(' ').toLowerCase();
    return addr.includes(q);
  });

  const handleSelectAgentboxListing = (listing) => {
    const street = listing.streetAddress || [listing.unitNumber, listing.streetNumber, listing.streetName].filter(Boolean).join(' ');
    const suburb = listing.suburb || '';
    const state = listing.state || '';
    const postcode = listing.postcode || '';
    const full = [street, suburb, state, postcode].filter(Boolean).join(', ');
    const area = [suburb, state].filter(Boolean).join(' ');

    setFormattedAddress(full);
    setAddress(area);
    if (listing.latitude && listing.longitude) {
      setLocation({ latitude: listing.latitude, longitude: listing.longitude });
    }

    // Pre-fill other fields
    const typeMap = { house: 1, apartment: 2, unit: 2, flat: 2, villa: 3, townhouse: 4, terrace: 4, duplex: 4, acreage: 5, land: 5, rural: 5 };
    const abType = (listing.type || '').toLowerCase();
    if (typeMap[abType]) setType(typeMap[abType]);

    let price = listing.price || listing.searchPrice || '';
    if (typeof price === 'string') price = price.replace(/[^0-9.]/g, '');
    if (parseFloat(price)) setPriceRaw(String(Math.round(parseFloat(price))));

    if (listing.bedrooms) setBedrooms(String(listing.bedrooms));
    if (listing.bathrooms) setBathrooms(String(listing.bathrooms));
    if (listing.carSpaces || listing.garages) setCarSpaces(String(listing.carSpaces || listing.garages));
    if (listing.landArea) setSquareFootage(String(listing.landArea));

    if (listing.headline || listing.title) setTitle(listing.headline || listing.title);
    if (listing.description) setDescription(listing.description);

    // Map features
    const featureMap = {};
    if (listing.pool) featureMap['Pool'] = true;
    if (listing.airConditioning) featureMap['Air Conditioning'] = true;
    if (listing.garage || listing.carSpaces > 0) featureMap['Garage / Secure Parking'] = true;
    setFeatures(featureMap);

    // Pre-fill images from URLs
    const imageUrls = (listing.images || listing.photos || [])
      .map((img) => (typeof img === 'string' ? img : img?.url || img?.original || img?.large || img?.medium || ''))
      .filter(Boolean);
    if (imageUrls.length > 0) setImages(imageUrls);

    setShowAgentboxPicker(false);
    setAbSearch('');
  };

  // Revoke object URLs on unmount only (not on every reorder)
  const imagesRef = useRef(images);
  imagesRef.current = images;
  useEffect(() => {
    return () => {
      imagesRef.current.forEach((f) => {
        if (typeof f !== 'string' && f?.preview) URL.revokeObjectURL(f.preview);
      });
    };
  }, []);

  const videoPreviewUrl = useMemo(() => {
    if (!video) return null;
    return URL.createObjectURL(video);
  }, [video]);

  const formattedPrice = useMemo(() => {
    if (!priceRaw) return '';
    try {
      return Intl.NumberFormat('en-AU', {
        style: 'currency',
        currency: 'AUD',
        maximumFractionDigits: 0,
      }).format(Number(priceRaw));
    } catch {
      return '';
    }
  }, [priceRaw]);

  const handlePlaceChanged = () => {
    const autocomplete = autocompleteRef.current;
    if (!autocomplete) return;

    const place = autocomplete.getPlace();
    const fullFormatted = place?.formatted_address || '';
    const lat = place?.geometry?.location?.lat?.();
    const lng = place?.geometry?.location?.lng?.();

    let areaAddress = '';
    if (place?.address_components) {
      const components = place.address_components;
      const suburb = components.find((c) => c.types.includes('locality'))?.long_name || '';
      const state = components.find((c) => c.types.includes('administrative_area_level_1'))?.short_name || '';
      const country = components.find((c) => c.types.includes('country'))?.long_name || '';
      areaAddress = [suburb, state, country].filter(Boolean).join(' ');
    }

    setAddress(areaAddress || '');
    setFormattedAddress(fullFormatted || '');
    if (lat && lng) {
      setLocation({ latitude: lat, longitude: lng });
    }
  };

  const [mediaDragging, setMediaDragging] = useState(false);

  const handleMediaUpload = (e) => {
    const files = Array.from(e.target.files || []);
    processMediaFiles(files);
  };

  const processMediaFiles = (files) => {
    setMediaError(null);
    const allowedVideoExts = ['.mp4', '.mov', '.webm', '.m4v'];
    const imageFiles = [];
    let videoFile = null;

    for (const f of files) {
      const ext = (f.name || '').toLowerCase().replace(/.*(\.\w+)$/, '$1');
      const isVideo = f.type.startsWith('video/') || allowedVideoExts.includes(ext);
      const isImage = f.type.startsWith('image/') || ext === '.heic' || ext === '.heif';

      if (isVideo) {
        if (f.size > 500 * 1024 * 1024) {
          setMediaError('Video file exceeds 500MB limit. Please choose a smaller file.');
          continue;
        }
        if (!allowedVideoExts.includes(ext)) {
          setMediaError(`Unsupported video format "${ext}". Please use MP4, MOV, WebM, or M4V.`);
          continue;
        }
        videoFile = f;
      } else if (isImage) {
        try {
          f.preview = URL.createObjectURL(f);
        } catch {
          f.preview = null;
        }
        imageFiles.push(f);
      }
    }

    if (imageFiles.length) setImages((prev) => [...prev, ...imageFiles]);
    if (videoFile) setVideo(videoFile);
  };

  const handleMediaDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setMediaDragging(false);
    processMediaFiles(Array.from(e.dataTransfer.files));
  };

  const removeImage = (index) => {
    // Any reordering of the cover photo invalidates a previously-chosen
    // focal point — it was framed for whichever photo used to be first.
    if (index === 0) setHeroFocalPoint(null);
    setImages((prev) => {
      const newImages = [...prev];
      const removed = newImages.splice(index, 1)[0];
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return newImages;
    });
  };

  const removeVideo = () => {
    setVideo(null);
  };

  const reorderImages = (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    // A previously-chosen focal point was framed for whatever photo
    // used to be at index 0 — if the cover photo itself is changing,
    // that framing no longer applies to whatever's now in that slot.
    if (fromIndex === 0 || toIndex === 0) setHeroFocalPoint(null);
    setImages(prev => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
  };

  // No upload or re-encode here — zoom is locked at 1 in the positioner
  // itself (see the ImagePositioner call below), so this only ever
  // records a focal point on the original file, never a crop. Stored on
  // the property as a ready CSS object-position value; applied by
  // PropertyHero.js via SmartPropertyImage's existing object-fit logic.
  const handleHeroPositionerSave = ({ croppedArea }) => {
    setPositioningHero(true);
    setHeroFocalPoint(cropAreaToObjectPosition(croppedArea));
    setPositioningHero(false);
    setShowHeroPositioner(false);
  };

  const toggleFeature = (feature) => {
    setFeatures((prev) => ({ ...prev, [feature]: !prev[feature] }));
  };

  // Validation
  const validateStep = () => {
    const newErrors = {};

    if (step === STEPS.ADDRESS) {
      if (!address || !location?.latitude || !location?.longitude) {
        newErrors.step = 'Please select a valid address from suggestions.';
      }
    }
    if (step === STEPS.TYPE && !type) {
      newErrors.step = 'Please select a property type.';
    }
    if (step === STEPS.PRICE && !priceRaw) {
      newErrors.step = 'Please enter an expected price.';
    }
    if (step === STEPS.DETAILS) {
      if (!bedrooms || !bathrooms || !carSpaces) {
        newErrors.step = 'Please add bedrooms, bathrooms and car spaces.';
      }
    }
    if (step === STEPS.IMAGES && images.length === 0) {
      newErrors.step = 'Please upload at least one image.';
    }
    if (step === STEPS.TITLE && !title.trim()) {
      newErrors.step = 'Please enter a title for the listing.';
    }
    if (step === STEPS.TERMS && !termsAccepted) {
      newErrors.step = 'Please accept the terms and conditions to continue.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const onNext = () => {
    setErrors({});
    if (!validateStep()) return;
    setStep((s) => s + 1);
  };

  const onBack = () => {
    if (step > STEPS.ADDRESS) {
      setErrors({});
      setStep((s) => s - 1);
    }
  };

  // Convert HEIC/HEIF files to JPEG before upload
  const convertHeicIfNeeded = async (file) => {
    const ext = (file.name || '').toLowerCase();
    if (ext.endsWith('.heic') || ext.endsWith('.heif') || file.type === 'image/heic' || file.type === 'image/heif') {
      try {
        const { default: heic2any } = await import('heic2any');
        const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
        const converted = new File(
          [blob],
          file.name.replace(/\.heic$|\.heif$/i, '.jpg'),
          { type: 'image/jpeg' }
        );
        return converted;
      } catch (err) {
        console.error('HEIC conversion failed:', err);
        return file;
      }
    }
    return file;
  };

  // Background upload helper — runs after redirect
  const uploadMediaInBackground = async (propertyId, userId, imageFiles, videoFile, existingUrls = []) => {
    const total = imageFiles.length;
    const imageUrls = [...existingUrls];

    try {
      // Upload images one by one
      for (let i = 0; i < total; i++) {
        const file = await convertHeicIfNeeded(imageFiles[i]);
        const storageRef = ref(storage, `propertyImages/${userId}/${Date.now()}-${file.name}`);
        const uploadTask = uploadBytesResumable(storageRef, file);

        await new Promise((resolve, reject) => {
          uploadTask.on(
            'state_changed',
            null,
            reject,
            async () => {
              const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
              imageUrls.push(downloadURL);
              await updateDoc(doc(db, 'properties', propertyId), {
                imageUrls: [...imageUrls],
                imageUploadProgress: {
                  uploaded: imageUrls.length - existingUrls.length,
                  total,
                  inProgress: (imageUrls.length - existingUrls.length) < total,
                },
              });
              resolve();
            }
          );
        });
      }

      // Upload video to Firebase Storage, then move to Bunny CDN
      if (videoFile) {
        try {
          const videoStorageRef = ref(storage, `propertyVideos/${userId}/${Date.now()}-${videoFile.name}`);
          const videoUploadTask = uploadBytesResumable(videoStorageRef, videoFile);

          await new Promise((resolve, reject) => {
            videoUploadTask.on(
              'state_changed',
              null,
              reject,
              async () => {
                const videoDownloadURL = await getDownloadURL(videoUploadTask.snapshot.ref);
                await updateDoc(doc(db, 'properties', propertyId), { videoUrl: videoDownloadURL });
                resolve();
              }
            );
          });
        } catch (err) {
          console.error('Video upload failed:', err);
        }
      }

      // Mark upload complete, flag for compression
      await updateDoc(doc(db, 'properties', propertyId), {
        imageUploadProgress: { uploaded: total, total, inProgress: false },
        imagesCompressed: false,
      });

      // Trigger server-side compression (fire-and-forget)
      fetch('/api/images/compress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId }),
      }).catch(err => console.error('Compress trigger failed:', err));
    } catch (err) {
      console.error('Background upload failed:', err);
    }
  };

  // Submit
  const handleSubmit = async () => {
    setErrors({});
    if (!termsAccepted) {
      setErrors({ step: 'Please accept the terms and conditions to continue.' });
      return;
    }
    // Server-side enforcement, not just the disabled button below —
    // a pricing lookup that never actually confirmed a real value
    // must never let a submission (and its charge) through, no
    // matter how the button's disabled state was reached.
    if (!pricingReady) {
      setErrors({ step: 'Unable to confirm current pricing. Please wait a moment or refresh the page before submitting.' });
      return;
    }
    if (!user) return;

    if (ownerUid) {
      // Office admin / team creator creating FOR another agent: the server checks authority and assigns
      // ownership to that agent. Photos go through the existing image upload first.
      if (video) {
        setErrors({ step: 'Video cannot be added when creating a campaign for another agent. Remove it, and the agent can add it later.' });
        return;
      }
      try {
        setIsSubmitting(true);
        if (!managedRequestId.current) managedRequestId.current = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}-0000000000`).replace(/[^A-Za-z0-9-]/g, '');
        const urls = images.filter((img) => typeof img === 'string');
        for (const f of images.filter((img) => typeof img !== 'string')) {
          const file = await convertHeicIfNeeded(f);
          const fd = new FormData();
          fd.append('file', file);
          const up = await authFetch('/api/upload-image', { method: 'POST', body: fd });
          if (!up.ok) throw new Error('A photo could not be uploaded. Nothing was created. Please try again.');
          urls.push((await up.json()).url);
        }
        const res = await authFetch('/api/properties/managed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ownerUid,
            requestId: managedRequestId.current,
            acceptTerms: termsAccepted,
            property: {
              address, formattedAddress, bathrooms, bedrooms, carSpaces, description, imageUrls: urls,
              ...(heroFocalPoint ? { heroFocalPoint } : {}),
              features: Object.keys(features).filter((f) => features[f]),
              location, price: priceRaw, squareFootage, title, propertyType: type, listingStatus, showSuburbOnly,
            },
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'The campaign could not be created.');
        router.push(assignable.role === 'officeAdmin' ? '/dashboard/office/campaigns?created=1' : '/dashboard?created=1');
      } catch (err) {
        console.error('Managed submit failed:', err);
        setErrors({ step: err.message || 'Something went wrong. Please try again.' });
        setIsSubmitting(false);
      }
      return;
    }

    try {
      setIsSubmitting(true);

      // Separate pre-existing URLs (from AgentBox) and files that need uploading
      const existingUrls = images.filter((img) => typeof img === 'string');
      const imageFiles = images.filter((img) => typeof img !== 'string');
      const needsUpload = imageFiles.length > 0;

      // Save property metadata immediately (no media yet)
      const propertyData = {
        address,
        formattedAddress,
        bathrooms,
        bedrooms,
        carSpaces,
        createdAt: serverTimestamp(),
        description,
        imageUrls: existingUrls,
        ...(heroFocalPoint ? { heroFocalPoint } : {}),
        imageUploadProgress: needsUpload
          ? { uploaded: 0, total: imageFiles.length, inProgress: true }
          : { uploaded: existingUrls.length, total: existingUrls.length, inProgress: false },
        features: Object.keys(features).filter((f) => features[f]),
        location,
        offPlan: false,
        postcode: '',
        priceHistory: [],
        price: priceRaw,
        toPrice: null,
        showPriceRange: false,
        squareFootage,
        title,
        active: true,
        visibility: false,
        acceptingOffers: true,
        campaignId: 'FqMZd0mWlNlSBl66s7BN',
        // The "how eager are you to sell" question was removed from this
        // flow. Kept as null so new properties keep the same shape; every
        // reader (PHI scoring, CRM) already treats null as "not set".
        isEager: null,
        clientName: null,
        clientEmail: null,
        clientPhone: null,
        propertyType: type,
        listingStatus,
        showSuburbOnly,
        wantsPremiumListing: false,
        agent: true,
        vendorUploaded: true,
        agentManaged: true,
        userId: user.uid,
        agentId: selectedAgentId || null,
        agentName: selectedAgentId ? (teamAgents.find(a => a.id === selectedAgentId)?.name || null) : null,
        agentAvatar: selectedAgentId ? (teamAgents.find(a => a.id === selectedAgentId)?.avatar || null) : null,
        stats: { views: 0 },
        termsAcceptedAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, 'properties'), propertyData);
      const propertyId = docRef.id;
      await setDoc(doc(db, 'draftProperties', propertyId), { ...propertyData, override: true });

      // Records the $200 agency charge for this property, the moment
      // it's created (its private buyer link is live from this same
      // instant — see billingService.js's own comment for why this
      // isn't gated on the visibility toggle). Best-effort: if this
      // call fails for any reason, the property is still fully usable
      // and is NOT left permanently unbilled — the monthly invoice-run
      // engine sweeps for exactly this before every run and records it
      // then instead. Never blocks the redirect below.
      authFetch(`/api/properties/${propertyId}/record-charge`, { method: 'POST' }).catch((err) => {
        console.error('Failed to record property charge (will be caught by the monthly run instead):', err);
      });

      // Create notification
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      await addDoc(collection(db, 'notifications'), {
        property: propertyData,
        createdAt: new Date(),
        read: false,
        type: 'newProspect',
        user: pickNotificationUser(userSnap.data(), user.uid),
      });

      // Kick off media upload in background — don't await (only for files, not URLs)
      if (needsUpload || video) {
        const filesCopy = [...imageFiles];
        const videoCopy = video;
        uploadMediaInBackground(propertyId, user.uid, filesCopy, videoCopy, existingUrls);
      }

      // Redirect immediately with success flag
      router.push('/dashboard?created=1');
    } catch (err) {
      console.error('Submit failed:', err);
      setErrors({ step: 'Something went wrong. Please try again.' });
      setIsSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#faf9f7] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-[#e38100]" />
      </div>
    );
  }

  if (!user) return null;

  const totalSteps = Object.keys(STEPS).length;
  const progressPercent = (step / totalSteps) * 100;

  return (
    <div className="min-h-screen bg-[#faf9f7] flex flex-col">
      {/* Header */}
      <div className="bg-[#faf9f7]/95 backdrop-blur border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-5 sm:px-8 pt-5 pb-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => step === STEPS.ADDRESS ? router.push('/dashboard') : onBack()}
                aria-label={step === STEPS.ADDRESS ? 'Back to dashboard' : 'Previous step'}
                className="-ml-2 p-2 rounded-md text-stone-500 hover:text-stone-900 hover:bg-stone-100/70 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.16em] text-stone-400">Add property</p>
                <h1 className="font-serif text-[17px] leading-snug text-stone-900 truncate">{STEP_LABELS[step]}</h1>
              </div>
            </div>
            <div className="flex items-center gap-4 flex-shrink-0">
              <p className="text-xs text-stone-500 tabular-nums">Step {step} of {totalSteps}</p>
              <button
                onClick={() => router.push('/dashboard')}
                aria-label="Close and return to dashboard"
                className="p-2 rounded-md text-stone-500 hover:text-stone-900 hover:bg-stone-100/70 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Progress */}
          <div className="mt-4 w-full h-px bg-stone-200 relative" role="progressbar" aria-valuemin={1} aria-valuemax={totalSteps} aria-valuenow={step}>
            <motion.div
              className="absolute left-0 top-[-0.5px] h-[2px] bg-[#e38100]"
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 max-w-2xl mx-auto w-full px-5 sm:px-8 py-10 sm:py-14">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
          >
            {/* Step 1: Address */}
            {step === STEPS.ADDRESS && (
              <div className="">
                {assignable.agents.length > 0 && (
                  <div className="mb-8 rounded-md border border-stone-200 bg-white p-4">
                    <label htmlFor="campaign-for" className="block text-[11px] uppercase tracking-[0.14em] text-stone-500 mb-2">Who is this campaign for?</label>
                    <select
                      id="campaign-for"
                      value={ownerUid}
                      onChange={(e) => { setOwnerUid(e.target.value); managedRequestId.current = null; }}
                      className="w-full px-4 py-3 rounded-md border border-stone-300 bg-white text-stone-900 outline-none focus:border-stone-500"
                    >
                      <option value="">Myself</option>
                      {assignable.agents.map((a) => (
                        <option key={a.uid} value={a.uid}>{a.name || a.email}{a.loginStatus === 'invited' ? ' (not logged in yet)' : ''}</option>
                      ))}
                    </select>
                    <p className="text-xs text-stone-500 mt-2">
                      {ownerUid
                        ? `The campaign will belong to the selected agent and appear on their dashboard, with you recorded as the creator. Photos only: the agent can add a video later. Billing follows the agent's existing billing arrangement.`
                        : assignable.role === 'officeAdmin' ? 'You can create campaigns for any agent in your office.' : 'You can create campaigns for agents in your team.'}
                    </p>
                  </div>
                )}
                <h2 className="font-serif text-[28px] sm:text-3xl leading-tight text-stone-900 mb-2">Where is the property?</h2>
                <p className="text-[15px] text-stone-500 mb-8">Start typing and select from the suggestions.</p>

                {mapsLoaded ? (
                  <Autocomplete
                    onLoad={(ref) => (autocompleteRef.current = ref)}
                    onPlaceChanged={handlePlaceChanged}
                    options={{ componentRestrictions: { country: 'au' }, types: ['address'] }}
                  >
                    <div className="relative">
                      <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
                      <input
                        type="text"
                        placeholder="123 Main Street, Sydney NSW"
                        className="w-full pl-12 pr-4 py-4 rounded-md border border-stone-300 bg-white focus:border-[#e38100] focus:ring-1 focus:ring-[#e38100]/30 outline-none transition-colors text-stone-900 text-base"
                      />
                    </div>
                  </Autocomplete>
                ) : (
                  <div className="relative">
                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-300" />
                    <input
                      type="text"
                      placeholder="Loading address search..."
                      disabled
                      className="w-full pl-12 pr-4 py-4 rounded-md border border-stone-200 bg-stone-50 text-stone-400 text-lg"
                    />
                  </div>
                )}

                {address && (
                  <div className="mt-4 p-4 bg-stone-100/60 rounded-md border border-stone-200">
                    <p className="text-sm text-stone-800"><strong>Selected:</strong> {formattedAddress}</p>
                  </div>
                )}

                {/* Show Address Toggle */}
                {address && (
                  <div className="mt-6 flex items-center justify-between p-4 bg-stone-50 rounded-md border border-stone-200">
                    <div>
                      <p className="text-sm font-medium text-stone-700">Hide street address</p>
                      <p className="text-xs text-stone-500 mt-0.5">
                        {showSuburbOnly
                          ? `Buyers will only see "${address}" — map will be hidden`
                          : 'Full address and map will be visible to buyers'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowSuburbOnly(!showSuburbOnly)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${showSuburbOnly ? 'bg-[#e38100]' : 'bg-stone-300'}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${showSuburbOnly ? 'translate-x-6' : 'translate-x-1'}`}
                      />
                    </button>
                  </div>
                )}

                {/* AgentBox option */}
                {agentboxConnected && (
                  <div className="mt-6 pt-6 border-t border-stone-200">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex-1 h-px bg-stone-200" />
                      <span className="text-xs font-medium text-stone-400 uppercase">or</span>
                      <div className="flex-1 h-px bg-stone-200" />
                    </div>
                    <button
                      onClick={() => setShowAgentboxPicker(true)}
                      type="button"
                      className="w-full flex items-center gap-4 px-5 py-4 rounded-md border border-stone-200 hover:border-stone-400 hover:bg-stone-100/50 transition-all group"
                    >
                      <div className="w-10 h-10 bg-stone-900 rounded-md flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-5 h-5 text-white" />
                      </div>
                      <div className="text-left flex-1">
                        <p className="text-sm font-medium text-stone-900 group-hover:text-[#e38100] transition-colors">Find property via Agentbox</p>
                        <p className="text-xs text-stone-500">Import address and details from your CRM listings</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-stone-300 group-hover:text-stone-500 transition-colors" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* AgentBox Picker Modal */}
            <AnimatePresence>
              {showAgentboxPicker && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
                  onMouseDown={(e) => { if (e.target === e.currentTarget) setShowAgentboxPicker(false); }}
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    className="bg-white rounded-md w-full max-w-2xl max-h-[80vh] flex flex-col shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between p-5 border-b border-stone-200 flex-shrink-0">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-stone-900 rounded-md flex items-center justify-center">
                          <Building2 className="w-4.5 h-4.5 text-white" />
                        </div>
                        <div>
                          <h2 className="font-serif text-lg text-stone-900">Select from Agentbox</h2>
                          <p className="text-xs text-stone-500">{abListings.length} listings available</p>
                        </div>
                      </div>
                      <button onClick={() => setShowAgentboxPicker(false)} className="p-2 hover:bg-stone-100 rounded-md transition-colors">
                        <X className="w-5 h-5 text-stone-400" />
                      </button>
                    </div>

                    {/* Search */}
                    <div className="px-5 py-3 border-b border-stone-100 flex-shrink-0">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                        <input
                          type="text"
                          value={abSearch}
                          onChange={(e) => setAbSearch(e.target.value)}
                          placeholder="Search by address or suburb..."
                          className="w-full pl-10 pr-4 py-2.5 border border-stone-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#e38100]/30 focus:border-[#e38100] bg-white transition-colors"
                        />
                      </div>
                    </div>

                    {/* Listings */}
                    <div className="flex-1 overflow-y-auto p-3">
                      {abLoading ? (
                        <div className="flex items-center justify-center py-16">
                          <Loader2 className="w-6 h-6 animate-spin text-[#e38100]" />
                        </div>
                      ) : filteredAbListings.length === 0 ? (
                        <div className="text-center py-16">
                          <Home className="w-10 h-10 text-stone-200 mx-auto mb-3" />
                          <p className="text-sm text-stone-500">{abSearch ? 'No listings match your search' : 'No listings found'}</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {filteredAbListings.map((listing) => {
                            const street = listing.streetAddress || [listing.unitNumber, listing.streetNumber, listing.streetName].filter(Boolean).join(' ');
                            const fullAddr = [street, listing.suburb, listing.state].filter(Boolean).join(', ');
                            const imgArr = listing.images || listing.photos || [];
                            const imgUrl = imgArr[0]?.url || imgArr[0]?.original || imgArr[0]?.medium || (typeof imgArr[0] === 'string' ? imgArr[0] : null);
                            const price = listing.displayPrice || (listing.price ? `$${Number(listing.price).toLocaleString('en-AU')}` : '');

                            return (
                              <button
                                key={listing.id}
                                onClick={() => handleSelectAgentboxListing(listing)}
                                className="w-full flex items-center gap-4 p-3 rounded-md border border-stone-100 hover:border-stone-400 hover:bg-stone-100/50 transition-all text-left group"
                              >
                                <div className="w-16 h-16 bg-stone-100 rounded-md overflow-hidden flex-shrink-0">
                                  {imgUrl ? (
                                    <img src={imgUrl} alt="" className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <Home className="w-6 h-6 text-stone-300" />
                                    </div>
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-stone-900 truncate group-hover:text-[#e38100] transition-colors">{fullAddr}</p>
                                  <div className="flex items-center gap-3 mt-1 text-xs text-stone-500">
                                    {price && <span className="font-semibold text-stone-700">{price}</span>}
                                    {listing.bedrooms != null && <span className="flex items-center gap-0.5"><Bed className="w-3 h-3" />{listing.bedrooms}</span>}
                                    {listing.bathrooms != null && <span className="flex items-center gap-0.5"><Bath className="w-3 h-3" />{listing.bathrooms}</span>}
                                    {(listing.carSpaces != null || listing.garages != null) && <span className="flex items-center gap-0.5"><Car className="w-3 h-3" />{listing.carSpaces || listing.garages}</span>}
                                    {listing.type && <span className="text-stone-400">{listing.type}</span>}
                                  </div>
                                </div>
                                {listing._imported && (
                                  <span className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider bg-stone-100 text-stone-600 rounded-sm flex-shrink-0">Imported</span>
                                )}
                                <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-stone-500 flex-shrink-0" />
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Step 2: Type */}
            {step === STEPS.TYPE && (
              <div className="">
                <h2 className="font-serif text-[28px] sm:text-3xl leading-tight text-stone-900 mb-2">Property type</h2>
                <p className="text-[15px] text-stone-500 mb-6">Choose the one that fits best.</p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {homeTypes.map((item, idx) => (
                    <button
                      key={idx}
                      onClick={() => setType(idx + 1)}
                      className={`px-3 py-3 rounded-md text-[15px] font-medium transition-colors border ${
                        type === idx + 1
                          ? 'bg-[#e38100] text-white border-[#e38100]'
                          : 'bg-white text-stone-700 border-stone-300 hover:border-stone-400'
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>

                {/* Listing status — the second required choice on this step */}
                <div className="mt-8 pt-7 border-t border-stone-200">
                  <h3 className="font-serif text-xl text-stone-900 mb-1">Is this property on the market?</h3>
                  <p className="text-sm text-stone-500 mb-4">Select one.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Listing status">
                    {[
                      { value: 'premarket', title: 'Pre-Market', desc: 'Not yet publicly listed. Collect buyer opinions to validate pricing.' },
                      { value: 'on-market', title: 'On Market', desc: 'Currently listed. Collect buyer opinions alongside your campaign.' },
                    ].map((opt) => {
                      const selected = listingStatus === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setListingStatus(opt.value)}
                          className={`text-left p-4 rounded-md border transition-colors ${
                            selected
                              ? 'bg-white border-[#e38100] ring-1 ring-[#e38100]'
                              : 'bg-white border-stone-300 hover:border-stone-400'
                          }`}
                        >
                          <span className="flex items-center gap-3">
                            <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${selected ? 'border-[#e38100]' : 'border-stone-400'}`}>
                              {selected && <span className="h-2 w-2 rounded-full bg-[#e38100]" />}
                            </span>
                            <span className="text-[15px] font-medium text-stone-900">{opt.title}</span>
                          </span>
                          <span className="mt-1.5 block pl-7 text-xs leading-relaxed text-stone-500">{opt.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Price */}
            {step === STEPS.PRICE && (
              <div className="">
                <h2 className="font-serif text-[28px] sm:text-3xl leading-tight text-stone-900 mb-2">Expected price</h2>
                <p className="text-[15px] text-stone-500 mb-8">Give us a ballpark figure.</p>

                <div className="relative">
                  <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-stone-400" />
                  <input
                    type="text"
                    placeholder="750,000"
                    value={formattedPrice}
                    onChange={(e) => {
                      const numeric = (e.target.value || '').replace(/\D/g, '');
                      setPriceRaw(numeric);
                    }}
                    className="w-full pl-12 pr-4 py-4 rounded-md border border-stone-300 bg-white focus:border-[#e38100] focus:ring-1 focus:ring-[#e38100]/30 outline-none transition-colors text-stone-900 text-2xl font-semibold"
                  />
                </div>
              </div>
            )}

            {/* Step 4: Details */}
            {step === STEPS.DETAILS && (
              <div className="">
                <h2 className="font-serif text-[28px] sm:text-3xl leading-tight text-stone-900 mb-2">Property details</h2>
                <p className="text-[15px] text-stone-500 mb-8">The basic details.</p>

                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[11px] uppercase tracking-[0.14em] text-stone-500 mb-2">Bedrooms</label>
                      <input
                        type="number"
                        placeholder="3"
                        value={bedrooms}
                        onChange={(e) => setBedrooms(e.target.value)}
                        className="w-full px-4 py-3 rounded-md border border-stone-300 bg-white focus:border-[#e38100] focus:ring-1 focus:ring-[#e38100]/30 outline-none transition-colors text-stone-900 text-base"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] uppercase tracking-[0.14em] text-stone-500 mb-2">Bathrooms</label>
                      <input
                        type="number"
                        placeholder="2"
                        value={bathrooms}
                        onChange={(e) => setBathrooms(e.target.value)}
                        className="w-full px-4 py-3 rounded-md border border-stone-300 bg-white focus:border-[#e38100] focus:ring-1 focus:ring-[#e38100]/30 outline-none transition-colors text-stone-900 text-base"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] uppercase tracking-[0.14em] text-stone-500 mb-2">Car Spaces</label>
                      <input
                        type="number"
                        placeholder="2"
                        value={carSpaces}
                        onChange={(e) => setCarSpaces(e.target.value)}
                        className="w-full px-4 py-3 rounded-md border border-stone-300 bg-white focus:border-[#e38100] focus:ring-1 focus:ring-[#e38100]/30 outline-none transition-colors text-stone-900 text-base"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] uppercase tracking-[0.14em] text-stone-500 mb-2">Land Size (sqm) - Optional</label>
                    <input
                      type="number"
                      placeholder="450"
                      value={squareFootage}
                      onChange={(e) => setSquareFootage(e.target.value)}
                      className="w-full px-4 py-3 rounded-md border border-stone-300 bg-white focus:border-[#e38100] focus:ring-1 focus:ring-[#e38100]/30 outline-none transition-colors text-stone-900 text-base"
                    />
                  </div>

                  <div className="pt-2">
                    <label className="block text-[11px] uppercase tracking-[0.14em] text-stone-500 mb-3">Features (Optional)</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {homeFeatures.map((feature) => (
                        <button
                          key={feature}
                          onClick={() => toggleFeature(feature)}
                          className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors border ${
                            features[feature]
                              ? 'bg-[#e38100] text-white border-[#e38100]'
                              : 'bg-white text-stone-700 border-stone-300 hover:border-stone-400'
                          }`}
                        >
                          {feature}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 5: Media */}
            {step === STEPS.IMAGES && (
              <div className="">
                <h2 className="font-serif text-[28px] sm:text-3xl leading-tight text-stone-900 mb-2">Add media</h2>
                <p className="text-[15px] text-stone-500 mb-8">Photos and an optional walkthrough video to showcase your property.</p>

                {/* Unified drop zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setMediaDragging(true); }}
                  onDragLeave={() => setMediaDragging(false)}
                  onDrop={handleMediaDrop}
                  onClick={() => document.getElementById('media-upload').click()}
                  className={`relative rounded-md p-10 text-center cursor-pointer transition-colors ${mediaDragging ? 'bg-stone-100/70 border border-dashed border-[#e38100]' : 'bg-white border border-dashed border-stone-300 hover:bg-stone-100/50 hover:border-stone-400'}`}
                >
                  <div className="flex flex-col items-center gap-3">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${mediaDragging ? 'bg-white' : 'bg-stone-100'}`}>
                      <ImageIcon className={`w-7 h-7 ${mediaDragging ? 'text-[#e38100]' : 'text-stone-400'}`} />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-stone-900">
                        {mediaDragging ? 'Drop files here' : 'Click or drag files to upload'}
                      </p>
                      <p className="text-sm text-stone-400 mt-1">Images (JPG, PNG, HEIC) and video (MP4, MOV, WebM)</p>
                    </div>
                  </div>
                  <input
                    type="file"
                    id="media-upload"
                    accept="image/*,.heic,.heif,video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.webm,.m4v"
                    multiple
                    onChange={handleMediaUpload}
                    className="hidden"
                  />
                </div>

                {mediaError && (
                  <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md flex items-center justify-between">
                    <p className="text-sm text-red-600">{mediaError}</p>
                    <button onClick={() => setMediaError(null)}>
                      <X className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                )}

                {/* Media grid — video first, then images */}
                {(video || images.length > 0) && (
                  <div className="mt-6">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-medium text-stone-500">
                          {images.length} photo{images.length !== 1 ? 's' : ''}{video ? ' + 1 video' : ''}
                        </p>
                        {images.length > 1 && (
                          <p className="text-xs text-stone-400 mt-0.5">Drag to reorder. First image is the cover photo.</p>
                        )}
                      </div>
                      <button
                        onClick={() => document.getElementById('media-upload').click()}
                        className="text-sm font-semibold text-[#e38100] hover:text-[#cc7400] transition-colors"
                      >
                        + Add more
                      </button>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                      {/* Video thumbnail first */}
                      {video && (
                        <div className="relative group col-span-2 row-span-2">
                          <video
                            src={videoPreviewUrl}
                            className="w-full h-full min-h-[14rem] object-cover rounded-md border border-stone-200"
                            muted
                            playsInline
                            onMouseOver={(e) => e.target.play()}
                            onMouseOut={(e) => { e.target.pause(); e.target.currentTime = 0; }}
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 rounded-md transition-colors" />
                          <span className="absolute bottom-2 left-2 px-2 py-1 bg-black/70 text-white text-xs font-medium rounded-md flex items-center gap-1">
                            <Video className="w-3 h-3" /> Video
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeVideo(); }}
                            className="absolute top-2 right-2 w-7 h-7 bg-black/60 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      {/* Image thumbnails */}
                      {images.map((img, i) => {
                        const src = typeof img === 'string' ? img : img?.preview;
                        if (!src) return null;
                        const isExternal = typeof img === 'string' && img.startsWith('http');
                        return (
                          <div
                            key={i}
                            className={`relative group aspect-square ${dragIndex === i ? 'opacity-40' : ''} ${dragOverIndex === i && dragIndex !== i ? 'ring-2 ring-[#e38100] rounded-md' : ''}`}
                            draggable
                            onDragStart={() => setDragIndex(i)}
                            onDragOver={(e) => { e.preventDefault(); setDragOverIndex(i); }}
                            onDragEnd={() => {
                              if (dragIndex !== null && dragOverIndex !== null) reorderImages(dragIndex, dragOverIndex);
                              setDragIndex(null);
                              setDragOverIndex(null);
                            }}
                          >
                            <img
                              src={src}
                              style={i === 0 && heroFocalPoint ? { objectPosition: heroFocalPoint } : undefined}
                              className="w-full h-full object-cover rounded-md border border-stone-200"
                              alt={`upload-${i}`}
                              draggable={false}
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 rounded-md transition-colors" />
                            <div className="absolute top-2 left-2 flex items-center gap-1">
                              <span className="w-7 h-7 bg-black/60 text-white rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing">
                                <GripVertical className="w-3.5 h-3.5" />
                              </span>
                              {i === 0 && (
                                <span className="px-1.5 py-0.5 bg-[#e38100] text-white text-[10px] font-medium uppercase tracking-wider rounded-sm">Cover</span>
                              )}
                            </div>
                            {i === 0 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setShowHeroPositioner(true); }}
                                className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 hover:bg-black/75 text-white text-[10px] font-semibold rounded-md sm:opacity-0 sm:group-hover:opacity-100 transition-all"
                              >
                                {heroFocalPoint ? 'Reposition' : 'Position'}
                              </button>
                            )}
                            <button
                              onClick={() => removeImage(i)}
                              className="absolute top-2 right-2 w-7 h-7 bg-black/60 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 6: Title & Description */}
            {step === STEPS.TITLE && (
              <div className="">
                <h2 className="font-serif text-[28px] sm:text-3xl leading-tight text-stone-900 mb-2">Listing details</h2>
                <p className="text-[15px] text-stone-500 mb-8">Add a title and a short description for the listing.</p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] uppercase tracking-[0.14em] text-stone-500 mb-2">Title</label>
                    <input
                      type="text"
                      placeholder="Beautiful family home in..."
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full px-4 py-3 rounded-md border border-stone-300 bg-white focus:border-[#e38100] focus:ring-1 focus:ring-[#e38100]/30 outline-none transition-colors text-stone-900 text-base"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-[0.14em] text-stone-500 mb-2">Description (Optional)</label>
                    <textarea
                      placeholder="Describe the property..."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={5}
                      className="w-full px-4 py-3 rounded-md border border-stone-300 bg-white focus:border-[#e38100] focus:ring-1 focus:ring-[#e38100]/30 outline-none transition-colors text-stone-900 resize-none"
                    />
                  </div>

                  {/* Agent Selector (listing-agent profiles belong to the signed-in user, so not used when creating for another agent) */}
                  {!ownerUid && <AgentSelector
                    agents={teamAgents}
                    selectedAgentId={selectedAgentId}
                    onSelect={setSelectedAgentId}
                    onAddNew={() => setShowAgentModal(true)}
                  />}
                </div>
              </div>
            )}

            {/* Agent Modal for inline create */}
            <AnimatePresence>
              {showAgentModal && (
                <AgentModal
                  show={showAgentModal}
                  onClose={() => setShowAgentModal(false)}
                  onSave={(saved) => {
                    setTeamAgents((prev) => [...prev, saved]);
                    setSelectedAgentId(saved.id);
                  }}
                  userId={user.uid}
                />
              )}
            </AnimatePresence>

            {/* Step 7: Terms & Conditions */}
            {step === STEPS.TERMS && (
              <div className="">
                <h2 className="font-serif text-[28px] sm:text-3xl leading-tight text-stone-900 mb-2">Terms &amp; Conditions</h2>
                <p className="text-[15px] text-stone-500 mb-8">Please read and accept the terms before submitting your property.</p>

                {termsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-[#e38100]" />
                  </div>
                ) : termsText ? (
                  <div className="bg-stone-50 border border-stone-200 rounded-md p-5 max-h-[400px] overflow-y-auto mb-6">
                    <p className="text-sm text-stone-700 whitespace-pre-wrap leading-relaxed">{termsText}</p>
                  </div>
                ) : (
                  <div className="bg-stone-50 border border-stone-200 rounded-md p-5 mb-6">
                    <p className="text-sm text-stone-500 italic">Terms and conditions are being updated. By proceeding, you agree to the Premarket platform terms of use.</p>
                  </div>
                )}

                {ownerUid && (
                  <p data-testid="managed-terms-note" className="mb-4 rounded-md border border-stone-200 bg-white p-4 text-sm text-stone-600">
                    You are accepting these terms yourself, as the person creating this campaign for{' '}
                    <strong>{assignable.agents.find((a) => a.uid === ownerUid)?.name || 'the selected agent'}</strong>.
                    The agent has not personally accepted them. Your acceptance is recorded against your name.
                  </p>
                )}

                <label
                  className={`flex items-center gap-3 p-4 rounded-md border cursor-pointer transition-all ${
                    termsAccepted
                      ? 'border-[#e38100] bg-white'
                      : 'border-stone-300 hover:border-stone-400'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className="w-5 h-5 rounded border-stone-300 text-[#e38100] focus:ring-[#e38100]/20 accent-[#e38100]"
                  />
                  <span className="text-sm font-medium text-stone-900">
                    I have read and agree to the terms and conditions
                  </span>
                </label>

                {!termsAccepted && errors.step && (
                  <p className="mt-3 text-sm text-[#e38100] font-medium">You must accept the terms to continue.</p>
                )}
              </div>
            )}

            {/* Error */}
            {errors.step && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 bg-red-50 border border-red-200 rounded-md p-4 text-center"
              >
                <p className="text-red-700 text-sm font-medium">{errors.step}</p>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Navigation */}
      <div className="bg-[#faf9f7]/95 backdrop-blur border-t border-stone-200 sticky bottom-0 z-10">
        <div className="max-w-2xl mx-auto px-5 sm:px-8 py-4">
          {/* Pricing disclosure — shown once, directly above Submit, on
              the terms/final step only. Figures come from the live
              /api/public/pricing-info endpoint (see pricingInfo
              state above), which reads the real settings/invoicing
              document server-side — never hardcoded independently of
              it, so this can't drift out of sync if pricing/terms
              are ever changed from the admin settings page. The
              30-day consolidation cycle itself isn't an admin-
              configurable setting (DEFAULT_BILLING_CYCLE_DAYS is a
              fixed constant in billingService.js), so that figure is
              safe to state directly. */}
          {step === STEPS.TERMS && pricingLoadFailed && retail.state === 'none' && (
            <div className="mb-3 bg-red-50 border border-red-200 rounded-md px-4 py-3 flex items-center justify-between gap-3">
              <p className="text-sm text-red-700">
                Unable to confirm current pricing. Submission is disabled until this is confirmed.
              </p>
              <button
                type="button"
                onClick={() => {
                  setPricingLoadFailed(false);
                  fetch('/api/public/pricing-info')
                    .then((res) => { if (!res.ok) throw new Error(`pricing-info returned ${res.status}`); return res.json(); })
                    .then((data) => { setPricingInfo((prev) => ({ ...prev, ...data })); setPricingLoaded(true); })
                    .catch(() => setPricingLoadFailed(true));
                }}
                className="text-sm font-semibold text-red-700 underline whitespace-nowrap"
              >
                Retry
              </button>
            </div>
          )}
          {step === STEPS.TERMS && retailFailed && (
            <div className="mb-3 bg-red-50 border border-red-200 rounded-md px-4 py-3 flex items-center justify-between gap-3">
              <p className="text-sm text-red-700">
                Unable to confirm current pricing. Submission is disabled until this is confirmed.
              </p>
              <button
                type="button"
                onClick={loadRetailPricing}
                className="text-sm font-semibold text-red-700 underline whitespace-nowrap"
              >
                Retry
              </button>
            </div>
          )}
          {step === STEPS.TERMS && !retailFailed && retail.state === 'retail' && (
            <div className="mb-3 bg-stone-100/60 border border-stone-200 rounded-md px-4 py-3">
              <p className="text-sm font-medium text-stone-900">
                Premarket campaign fee — ${retail.price} AUD per campaign
              </p>
              <p className="text-xs text-stone-600 mt-1 leading-relaxed">
                The campaign fee is payable by the vendor through your agency.
              </p>
            </div>
          )}
          {step === STEPS.TERMS && !retailFailed && retail.state === 'unknown' && (
            <div className="mb-3 bg-stone-100/60 border border-stone-200 rounded-md px-4 py-3">
              <p className="text-sm font-medium text-stone-900">Confirming current pricing…</p>
            </div>
          )}
          {step === STEPS.TERMS && !pricingLoadFailed && retail.state === 'none' && (
            <div className="mb-3 bg-stone-100/60 border border-stone-200 rounded-md px-4 py-3">
              <p className="text-sm font-medium text-stone-900">
                {pricingLoaded
                  ? `Premarket campaign fee — $${pricingInfo.pricePerListing} AUD (${pricingInfo.gstRate === 0 ? 'no GST charged' : 'plus GST'})`
                  : 'Confirming current pricing…'}
              </p>
              <p className="text-xs text-stone-600 mt-1 leading-relaxed">
                By submitting this property, you acknowledge that your agency will be charged ${pricingInfo.pricePerListing}. Charges are consolidated into one agency invoice every 30 days, with payment due within {pricingInfo.paymentTermsDays} days of issue.
              </p>
            </div>
          )}
          <div className="flex justify-between items-center">
            {step > STEPS.ADDRESS ? (
              <button
                onClick={onBack}
                className="px-5 py-3 rounded-md border border-stone-300 text-stone-700 text-sm font-medium tracking-wide hover:bg-stone-100/70 transition-colors"
              >
                Back
              </button>
            ) : (
              <div />
            )}

            {step < STEPS.TERMS ? (
              <button
                onClick={onNext}
                className="px-8 py-3 bg-[#e38100] hover:bg-[#cc7400] text-white text-sm font-medium tracking-wide rounded-md transition-colors"
              >
                Continue
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !termsAccepted || !pricingReady}
                className="px-8 py-3 bg-[#e38100] hover:bg-[#cc7400] text-white text-sm font-medium tracking-wide rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Submitting...' : !pricingReady ? 'Confirming pricing…' : 'Submit Property'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Saving Overlay */}
      {isSubmitting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-md p-10 shadow-xl text-center max-w-md mx-4">
            <div className="w-14 h-14 border-4 border-[#e38100] border-t-transparent rounded-full animate-spin mx-auto mb-5"></div>
            <h2 className="font-serif text-xl text-stone-900 mb-2">Creating listing...</h2>
            <p className="text-stone-500 text-sm">This will only take a moment.</p>
          </div>
        </div>
      )}

      {showHeroPositioner && images[0] && (
        <ImagePositioner
          imageSrc={typeof images[0] === 'string' ? images[0] : images[0]?.preview}
          aspect={16 / 10}
          cropShape="rect"
          minZoom={1}
          maxZoom={1}
          title="Position your cover photo"
          description="Drag to choose what's centred when this photo is shown as the listing's hero image."
          onCancel={() => setShowHeroPositioner(false)}
          onSave={handleHeroPositionerSave}
          saving={positioningHero}
        />
      )}
    </div>
  );
}
