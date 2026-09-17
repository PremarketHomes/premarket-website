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
import { resizeImageForUpload, runWithConcurrency } from '../../utils/imageUpload';
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
  Sparkles,
  Video,
  Building2,
  Search,
  Loader2,
  FileText,
  GripVertical,
  Clock,
  User,
  Mail,
  Phone,
  Shield,
} from 'lucide-react';
import { onSnapshot, query, where } from 'firebase/firestore';
import AgentSelector from '../../components/AgentSelector';
import AgentModal from '../../components/AgentModal';

const STEPS = {
  ADDRESS: 1,
  TYPE: 2,
  PRICE: 3,
  DETAILS: 4,
  IMAGES: 5,
  TITLE: 6,
  EAGERNESS: 7,
  CLIENT_INFO: 8,
  TERMS: 9,
};

const eagernessOptions = ['Very serious', 'Serious if the price is right', 'Just testing the waters'];

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
  const [video, setVideo] = useState(null);
  const [eagerness, setEagerness] = useState(null);
  const [showSuburbOnly, setShowSuburbOnly] = useState(false);
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');

  // Terms state
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsText, setTermsText] = useState('');
  const [termsLoading, setTermsLoading] = useState(true);

  // UX state
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [mediaError, setMediaError] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

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
      router.push('/join');
    }
  }, [user, authLoading, router]);

  // Load terms and conditions from Firestore
  useEffect(() => {
    if (!user) return;
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
  }, [user, userData?.agent]);

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
    setImages(prev => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
  };

  const handleGenerateAI = async () => {
    setIsGenerating(true);
    try {
      const selectedFeatures = Object.keys(features).filter((f) => features[f]);
      const res = await authFetch('/api/generate-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyType: homeTypes[type - 1],
          address,
          bedrooms,
          bathrooms,
          squareFeatures: squareFootage,
          features: selectedFeatures,
          price: priceRaw,
        }),
      });
      if (!res.ok) throw new Error('Failed to generate');
      const data = await res.json();
      if (data.title) setTitle(data.title);
      if (data.description) setDescription(data.description);
    } catch (err) {
      console.error('AI generation failed:', err);
    } finally {
      setIsGenerating(false);
    }
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
    if (step === STEPS.EAGERNESS && eagerness === null) {
      newErrors.step = 'Please select a sales timeline.';
    }
    if (step === STEPS.CLIENT_INFO) {
      if (!clientName.trim() || !clientEmail.trim() || !clientPhone.trim()) {
        newErrors.step = 'Please fill in all client information fields.';
      }
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
    const uploadedUrls = new Array(total);
    let completed = 0;
    let failed = 0;

    try {
      // Resize + upload up to 4 images at once — real speedup over one-at-a-
      // time without firing off dozens of simultaneous decodes/uploads.
      await runWithConcurrency(imageFiles, async (rawFile, i) => {
        const converted = await convertHeicIfNeeded(rawFile);
        const file = await resizeImageForUpload(converted);
        const storageRef = ref(storage, `propertyImages/${userId}/${Date.now()}-${i}-${file.name}`);
        const uploadTask = uploadBytesResumable(storageRef, file);

        try {
          const downloadURL = await new Promise((resolve, reject) => {
            uploadTask.on('state_changed', null, reject, async () => {
              try {
                resolve(await getDownloadURL(uploadTask.snapshot.ref));
              } catch (err) {
                reject(err);
              }
            });
          });
          uploadedUrls[i] = downloadURL;
        } catch (err) {
          console.error(`Image ${i + 1} of ${total} failed to upload:`, err);
          failed += 1;
        } finally {
          completed += 1;
          await updateDoc(doc(db, 'properties', propertyId), {
            imageUrls: [...existingUrls, ...uploadedUrls.filter(Boolean)],
            imageUploadProgress: {
              uploaded: completed - failed,
              total,
              failed,
              inProgress: completed < total,
            },
          });
        }
      }, 4);

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

      // Authoritative final write — guards against any out-of-order network
      // response among the parallel per-image progress writes above, and
      // flags the property for server-side compression.
      await updateDoc(doc(db, 'properties', propertyId), {
        imageUrls: [...existingUrls, ...uploadedUrls.filter(Boolean)],
        imageUploadProgress: { uploaded: total - failed, total, failed, inProgress: false },
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
    if (!user) return;

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
        isEager: eagerness,
        clientName: clientName.trim() || null,
        clientEmail: clientEmail.trim() || null,
        clientPhone: clientPhone.trim() || null,
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

      // Create notification
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      await addDoc(collection(db, 'notifications'), {
        property: propertyData,
        createdAt: new Date(),
        read: false,
        type: 'newProspect',
        user: userSnap.data(),
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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    );
  }

  if (!user) return null;

  const totalSteps = Object.keys(STEPS).length;
  const progressPercent = (step / totalSteps) * 100;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => step === STEPS.ADDRESS ? router.push('/dashboard') : onBack()}
                className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-slate-600" />
              </button>
              <div>
                <h1 className="text-lg font-bold text-slate-900">Add Property</h1>
                <p className="text-xs text-slate-500">Step {step} of {totalSteps}</p>
              </div>
            </div>
            <button
              onClick={() => router.push('/dashboard')}
              className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
            >
              <X className="w-5 h-5 text-slate-600" />
            </button>
          </div>

          {/* Progress Bar */}
          <div className="mt-3 w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-[#e48900] to-[#c64500]"
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            {/* Step 1: Address */}
            {step === STEPS.ADDRESS && (
              <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Where is the property?</h2>
                <p className="text-slate-500 mb-6">Start typing and select from the suggestions.</p>

                {mapsLoaded ? (
                  <Autocomplete onLoad={(ref) => (autocompleteRef.current = ref)} onPlaceChanged={handlePlaceChanged}>
                    <div className="relative">
                      <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input
                        type="text"
                        placeholder="123 Main Street, Sydney NSW"
                        className="w-full pl-12 pr-4 py-4 rounded-xl border border-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all text-slate-900 text-lg"
                      />
                    </div>
                  </Autocomplete>
                ) : (
                  <div className="relative">
                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                    <input
                      type="text"
                      placeholder="Loading address search..."
                      disabled
                      className="w-full pl-12 pr-4 py-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-400 text-lg"
                    />
                  </div>
                )}

                {address && (
                  <div className="mt-4 p-4 bg-orange-50 rounded-xl border border-orange-200">
                    <p className="text-sm text-orange-800"><strong>Selected:</strong> {formattedAddress}</p>
                  </div>
                )}

                {/* Show Address Toggle */}
                {address && (
                  <div className="mt-6 flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <div>
                      <p className="text-sm font-medium text-slate-700">Hide street address</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {showSuburbOnly
                          ? `Buyers will only see "${address}" — map will be hidden`
                          : 'Full address and map will be visible to buyers'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowSuburbOnly(!showSuburbOnly)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${showSuburbOnly ? 'bg-orange-500' : 'bg-slate-300'}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${showSuburbOnly ? 'translate-x-6' : 'translate-x-1'}`}
                      />
                    </button>
                  </div>
                )}

                {/* AgentBox option */}
                {agentboxConnected && (
                  <div className="mt-6 pt-6 border-t border-slate-200">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex-1 h-px bg-slate-200" />
                      <span className="text-xs font-medium text-slate-400 uppercase">or</span>
                      <div className="flex-1 h-px bg-slate-200" />
                    </div>
                    <button
                      onClick={() => setShowAgentboxPicker(true)}
                      type="button"
                      className="w-full flex items-center gap-4 px-5 py-4 rounded-xl border border-slate-200 hover:border-orange-300 hover:bg-orange-50/50 transition-all group"
                    >
                      <div className="w-10 h-10 bg-slate-900 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-5 h-5 text-white" />
                      </div>
                      <div className="text-left flex-1">
                        <p className="text-sm font-semibold text-slate-900 group-hover:text-orange-700 transition-colors">Find property via Agentbox</p>
                        <p className="text-xs text-slate-500">Import address and details from your CRM listings</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-orange-400 transition-colors" />
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
                    className="bg-white rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between p-5 border-b border-slate-200 flex-shrink-0">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-slate-900 rounded-lg flex items-center justify-center">
                          <Building2 className="w-4.5 h-4.5 text-white" />
                        </div>
                        <div>
                          <h2 className="text-lg font-bold text-slate-900">Select from Agentbox</h2>
                          <p className="text-xs text-slate-500">{abListings.length} listings available</p>
                        </div>
                      </div>
                      <button onClick={() => setShowAgentboxPicker(false)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                        <X className="w-5 h-5 text-slate-400" />
                      </button>
                    </div>

                    {/* Search */}
                    <div className="px-5 py-3 border-b border-slate-100 flex-shrink-0">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="text"
                          value={abSearch}
                          onChange={(e) => setAbSearch(e.target.value)}
                          placeholder="Search by address or suburb..."
                          className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 bg-white transition-all"
                        />
                      </div>
                    </div>

                    {/* Listings */}
                    <div className="flex-1 overflow-y-auto p-3">
                      {abLoading ? (
                        <div className="flex items-center justify-center py-16">
                          <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
                        </div>
                      ) : filteredAbListings.length === 0 ? (
                        <div className="text-center py-16">
                          <Home className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                          <p className="text-sm text-slate-500">{abSearch ? 'No listings match your search' : 'No listings found'}</p>
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
                                className="w-full flex items-center gap-4 p-3 rounded-xl border border-slate-100 hover:border-orange-300 hover:bg-orange-50/30 transition-all text-left group"
                              >
                                <div className="w-16 h-16 bg-slate-100 rounded-lg overflow-hidden flex-shrink-0">
                                  {imgUrl ? (
                                    <img src={imgUrl} alt="" className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <Home className="w-6 h-6 text-slate-300" />
                                    </div>
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-slate-900 truncate group-hover:text-orange-700 transition-colors">{fullAddr}</p>
                                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                                    {price && <span className="font-semibold text-slate-700">{price}</span>}
                                    {listing.bedrooms != null && <span className="flex items-center gap-0.5"><Bed className="w-3 h-3" />{listing.bedrooms}</span>}
                                    {listing.bathrooms != null && <span className="flex items-center gap-0.5"><Bath className="w-3 h-3" />{listing.bathrooms}</span>}
                                    {(listing.carSpaces != null || listing.garages != null) && <span className="flex items-center gap-0.5"><Car className="w-3 h-3" />{listing.carSpaces || listing.garages}</span>}
                                    {listing.type && <span className="text-slate-400">{listing.type}</span>}
                                  </div>
                                </div>
                                {listing._imported && (
                                  <span className="px-2 py-1 text-[10px] font-bold bg-emerald-50 text-emerald-600 rounded-full flex-shrink-0">Imported</span>
                                )}
                                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-orange-400 flex-shrink-0" />
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
              <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Property type</h2>
                <p className="text-slate-500 mb-6">Choose the one that fits best.</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {homeTypes.map((item, idx) => (
                    <button
                      key={idx}
                      onClick={() => setType(idx + 1)}
                      className={`px-6 py-4 rounded-xl text-lg font-medium transition-all border ${
                        type === idx + 1
                          ? 'bg-gradient-to-r from-[#e48900] to-[#c64500] text-white border-orange-500 shadow-lg'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-orange-300 hover:shadow-md'
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>

                {/* Listing Status Toggle */}
                <div className="mt-8 pt-6 border-t border-slate-200">
                  <label className="block text-sm font-medium text-slate-700 mb-3">Listing status</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setListingStatus('premarket')}
                      className={`px-5 py-3.5 rounded-xl text-sm font-semibold transition-all border ${
                        listingStatus === 'premarket'
                          ? 'bg-gradient-to-r from-[#e48900] to-[#c64500] text-white border-orange-500 shadow-lg'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-orange-300'
                      }`}
                    >
                      Pre-Market
                    </button>
                    <button
                      onClick={() => setListingStatus('on-market')}
                      className={`px-5 py-3.5 rounded-xl text-sm font-semibold transition-all border ${
                        listingStatus === 'on-market'
                          ? 'bg-emerald-600 text-white border-emerald-500 shadow-lg'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-emerald-300'
                      }`}
                    >
                      On Market
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 mt-2">
                    {listingStatus === 'premarket'
                      ? 'This property is not yet publicly listed \u2014 collect buyer opinions to validate pricing.'
                      : 'This property is currently listed on the market \u2014 collect buyer opinions alongside your campaign.'}
                  </p>
                </div>
              </div>
            )}

            {/* Step 3: Price */}
            {step === STEPS.PRICE && (
              <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Expected price</h2>
                <p className="text-slate-500 mb-6">Give us a ballpark figure.</p>

                <div className="relative">
                  <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-slate-400" />
                  <input
                    type="text"
                    placeholder="750,000"
                    value={formattedPrice}
                    onChange={(e) => {
                      const numeric = (e.target.value || '').replace(/\D/g, '');
                      setPriceRaw(numeric);
                    }}
                    className="w-full pl-12 pr-4 py-4 rounded-xl border border-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all text-slate-900 text-2xl font-semibold"
                  />
                </div>
              </div>
            )}

            {/* Step 4: Details */}
            {step === STEPS.DETAILS && (
              <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Property details</h2>
                <p className="text-slate-500 mb-6">The basic details.</p>

                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Bedrooms</label>
                      <input
                        type="number"
                        placeholder="3"
                        value={bedrooms}
                        onChange={(e) => setBedrooms(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all text-slate-900 text-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Bathrooms</label>
                      <input
                        type="number"
                        placeholder="2"
                        value={bathrooms}
                        onChange={(e) => setBathrooms(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all text-slate-900 text-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Car Spaces</label>
                      <input
                        type="number"
                        placeholder="2"
                        value={carSpaces}
                        onChange={(e) => setCarSpaces(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all text-slate-900 text-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Land Size (sqm) - Optional</label>
                    <input
                      type="number"
                      placeholder="450"
                      value={squareFootage}
                      onChange={(e) => setSquareFootage(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all text-slate-900 text-lg"
                    />
                  </div>

                  <div className="pt-2">
                    <label className="block text-sm font-medium text-slate-700 mb-3">Features (Optional)</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {homeFeatures.map((feature) => (
                        <button
                          key={feature}
                          onClick={() => toggleFeature(feature)}
                          className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                            features[feature]
                              ? 'bg-gradient-to-r from-[#e48900] to-[#c64500] text-white border-orange-500'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-orange-300'
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
              <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
                <h2 className="text-2xl font-bold text-slate-900 mb-1">Add media</h2>
                <p className="text-slate-500 mb-6">Photos and an optional walkthrough video to showcase your property.</p>

                {/* Unified drop zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setMediaDragging(true); }}
                  onDragLeave={() => setMediaDragging(false)}
                  onDrop={handleMediaDrop}
                  onClick={() => document.getElementById('media-upload').click()}
                  className={`relative rounded-2xl p-10 text-center cursor-pointer transition-all duration-200 ${mediaDragging ? 'bg-orange-50 border-2 border-orange-400 scale-[1.01]' : 'bg-slate-50 border-2 border-dashed border-slate-200 hover:bg-orange-50/50 hover:border-orange-300'}`}
                >
                  <div className="flex flex-col items-center gap-3">
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${mediaDragging ? 'bg-orange-100' : 'bg-slate-100'}`}>
                      <ImageIcon className={`w-7 h-7 ${mediaDragging ? 'text-orange-500' : 'text-slate-400'}`} />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-slate-900">
                        {mediaDragging ? 'Drop files here' : 'Click or drag files to upload'}
                      </p>
                      <p className="text-sm text-slate-400 mt-1">Images (JPG, PNG, HEIC) and video (MP4, MOV, WebM)</p>
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
                  <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
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
                        <p className="text-sm font-medium text-slate-500">
                          {images.length} photo{images.length !== 1 ? 's' : ''}{video ? ' + 1 video' : ''}
                        </p>
                        {images.length > 1 && (
                          <p className="text-xs text-slate-400 mt-0.5">Drag to reorder. First image is the cover photo.</p>
                        )}
                      </div>
                      <button
                        onClick={() => document.getElementById('media-upload').click()}
                        className="text-sm font-semibold text-orange-600 hover:text-orange-700 transition-colors"
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
                            className="w-full h-full min-h-[14rem] object-cover rounded-xl border border-slate-200"
                            muted
                            playsInline
                            onMouseOver={(e) => e.target.play()}
                            onMouseOut={(e) => { e.target.pause(); e.target.currentTime = 0; }}
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 rounded-xl transition-colors" />
                          <span className="absolute bottom-2 left-2 px-2 py-1 bg-black/70 text-white text-xs font-medium rounded-lg flex items-center gap-1">
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
                            className={`relative group aspect-square ${dragIndex === i ? 'opacity-40' : ''} ${dragOverIndex === i && dragIndex !== i ? 'ring-2 ring-orange-400 rounded-xl' : ''}`}
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
                              className="w-full h-full object-cover rounded-xl border border-slate-200"
                              alt={`upload-${i}`}
                              draggable={false}
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 rounded-xl transition-colors" />
                            <div className="absolute top-2 left-2 flex items-center gap-1">
                              <span className="w-7 h-7 bg-black/60 text-white rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing">
                                <GripVertical className="w-3.5 h-3.5" />
                              </span>
                              {i === 0 && (
                                <span className="px-1.5 py-0.5 bg-orange-500 text-white text-[10px] font-bold rounded-md">Cover</span>
                              )}
                            </div>
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
              <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-2xl font-bold text-slate-900">Listing details</h2>
                  <button
                    onClick={handleGenerateAI}
                    disabled={isGenerating}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-sm font-semibold hover:from-purple-700 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/25"
                  >
                    <Sparkles className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
                    {isGenerating ? 'Generating...' : 'Generate with AI'}
                  </button>
                </div>
                <p className="text-slate-500 mb-6">Add a title and description, or let AI generate them for you.</p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Title</label>
                    <input
                      type="text"
                      placeholder="Beautiful family home in..."
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all text-slate-900 text-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Description (Optional)</label>
                    <textarea
                      placeholder="Describe the property..."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={5}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all text-slate-900 resize-none"
                    />
                  </div>

                  {/* Agent Selector */}
                  <AgentSelector
                    agents={teamAgents}
                    selectedAgentId={selectedAgentId}
                    onSelect={setSelectedAgentId}
                    onAddNew={() => setShowAgentModal(true)}
                  />
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

            {/* Step 7: Sales Timeline */}
            {step === STEPS.EAGERNESS && (
              <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
                <div className="flex items-center gap-3 mb-2">
                  <Clock className="w-6 h-6 text-orange-500" />
                  <h2 className="text-2xl font-bold text-slate-900">Sales Timeline</h2>
                </div>
                <p className="text-slate-500 mb-6">How eager are you to sell?</p>

                <div className="grid grid-cols-1 gap-3">
                  {eagernessOptions.map((option, idx) => (
                    <button
                      key={idx}
                      onClick={() => setEagerness(idx)}
                      className={`px-6 py-4 rounded-xl text-lg font-medium transition-all border text-left ${
                        eagerness === idx
                          ? 'bg-gradient-to-r from-[#e48900] to-[#c64500] text-white border-orange-500 shadow-lg'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-orange-300 hover:shadow-md'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 8: Client Information */}
            {step === STEPS.CLIENT_INFO && (
              <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Client Information</h2>
                <p className="text-slate-500 mb-6">Enter the property owner's contact details.</p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Client Name</label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input
                        type="text"
                        placeholder="John Smith"
                        value={clientName}
                        onChange={(e) => setClientName(e.target.value)}
                        className="w-full pl-12 pr-4 py-4 rounded-xl border border-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all text-slate-900 text-lg"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Client Email</label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input
                        type="email"
                        placeholder="john@example.com"
                        value={clientEmail}
                        onChange={(e) => setClientEmail(e.target.value)}
                        className="w-full pl-12 pr-4 py-4 rounded-xl border border-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all text-slate-900 text-lg"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Client Phone</label>
                    <div className="relative">
                      <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input
                        type="tel"
                        placeholder="0400 000 000"
                        value={clientPhone}
                        onChange={(e) => setClientPhone(e.target.value)}
                        className="w-full pl-12 pr-4 py-4 rounded-xl border border-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all text-slate-900 text-lg"
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-6 flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <Shield className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-slate-700">Your client&apos;s privacy is protected</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Your client will not receive any communication from Premarket at any stage. We use this information solely for compliance purposes and to personalise the reports we generate for you.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Step 9: Terms & Conditions */}
            {step === STEPS.TERMS && (
              <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200">
                <div className="flex items-center gap-3 mb-2">
                  <FileText className="w-6 h-6 text-orange-500" />
                  <h2 className="text-2xl font-bold text-slate-900">Terms & Conditions</h2>
                </div>
                <p className="text-slate-500 mb-6">Please read and accept the terms before submitting your property.</p>

                {termsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
                  </div>
                ) : termsText ? (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 max-h-[400px] overflow-y-auto mb-6">
                    <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{termsText}</p>
                  </div>
                ) : (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 mb-6">
                    <p className="text-sm text-slate-500 italic">Terms and conditions are being updated. By proceeding, you agree to the Premarket platform terms of use.</p>
                  </div>
                )}

                <label
                  className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
                    termsAccepted
                      ? 'border-orange-400 bg-orange-50'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className="w-5 h-5 rounded border-slate-300 text-orange-500 focus:ring-orange-500/20 accent-orange-500"
                  />
                  <span className="text-sm font-medium text-slate-900">
                    I have read and agree to the terms and conditions
                  </span>
                </label>

                {!termsAccepted && errors.step && (
                  <p className="mt-3 text-sm text-orange-600 font-medium">You must accept the terms to continue.</p>
                )}
              </div>
            )}

            {/* Error */}
            {errors.step && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4 text-center"
              >
                <p className="text-red-700 text-sm font-medium">{errors.step}</p>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Navigation */}
      <div className="bg-white border-t border-slate-200 sticky bottom-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex justify-between items-center">
            {step > STEPS.ADDRESS ? (
              <button
                onClick={onBack}
                className="px-5 py-3 rounded-xl bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition-colors"
              >
                Back
              </button>
            ) : (
              <div />
            )}

            {step < STEPS.TERMS ? (
              <button
                onClick={onNext}
                className="px-8 py-3 bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-semibold rounded-xl shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 transition-all"
              >
                Continue
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !termsAccepted}
                className="px-8 py-3 bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-semibold rounded-xl shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Submitting...' : 'Submit Property'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Saving Overlay */}
      {isSubmitting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-10 shadow-2xl text-center max-w-md mx-4">
            <div className="w-14 h-14 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-5"></div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Creating listing...</h2>
            <p className="text-slate-500 text-sm">This will only take a moment.</p>
          </div>
        </div>
      )}
    </div>
  );
}
