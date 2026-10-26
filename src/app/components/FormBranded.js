'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { X, Home, MapPin, DollarSign, Bed, Image as ImageIcon, User, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { LoadScript, Autocomplete } from '@react-google-maps/api';
import { useModal } from '../context/ModalContext';
import { useSearchParams } from 'next/navigation';
import { storage, db } from '../firebase/clientApp';
import { pickNotificationUser } from '../utils/notificationUser';

import {
  collection,
  addDoc,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  setDoc,
  getDocs,
  orderBy,
  limit,
  query,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

const STEPS = {
  INTRO: 1,
  GOAL: 2,
  ADDRESS: 3,
  TYPE: 4,
  PRICE: 5,
  DETAILS: 6,
  IMAGES: 7,
  COMPLETE: 8,
};

const STEP_ICONS = {
  1: User,
  2: Home,
  3: MapPin,
  4: Home,
  5: DollarSign,
  6: Bed,
  7: ImageIcon,
};

export default function PropertyFormModal() {
  const searchParams = useSearchParams();
  const userId = searchParams.get('agent');

  const autocompleteRef = useRef(null);
  const { showModal, setShowModal } = useModal();
  const isHidden = !showModal;

  // wizard
  const [step, setStep] = useState(STEPS.INTRO);

  // property
  const [propertyId, setPropertyId] = useState(null);
  const [startDate, setStartDate] = useState(null);

  // contact
  const [clientName, setFullName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setPhone] = useState('');

  // choices
  const [type, setType] = useState(null);

  // location
  const [formattedAddress, setFormattedAddress] = useState(null);
  const [address, setAddress] = useState(null);
  const [location, setLocation] = useState(null);

  // numbers/details
  const [priceRaw, setPriceRaw] = useState('');
  const [bathrooms, setBathrooms] = useState('');
  const [bedrooms, setBedrooms] = useState('');
  const [carSpaces, setCarSpaces] = useState('');
  const [squareFootage, setSquareFootage] = useState('');
  const [features, setFeatures] = useState({});

  // content
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // images
  const [images, setImages] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);


  // ux
  const [errors, setErrors] = useState({});
  const [navLoading, setNavLoading] = useState(false);

  const [gotoMarketGoal, setGotoMarketGoal] = useState(null);

  const homeTypes = ['House', 'Apartment', 'Villa', 'Townhouse', 'Acreage', 'Duplex'];
  const homeFeatures = [
    'Pool',
    'Granny Flat',
    'Solar',
    'Air Conditioning',
    'Outdoor Entertainment Area',
    'Garage / Secure Parking',
    'Study',
    'Ensuite',
    'Smart Home Features',
    'Built-in Wardrobes',
  ];

  const GOAL_OPTIONS = [
    { label: 'ASAP (I\'m ready now!)', months: 1 },
    { label: 'Within the next 6 months', months: 6 },
    { label: 'Within 1 year', months: 12 },
    { label: 'Within 2 years', months: 24 },
    { label: 'Later than 2 years', months: 36 },
  ];

  // ---------- Effects ----------
  useEffect(() => {
    (async () => {
      try {
        const q = query(collection(db, 'campaigns'), orderBy('created', 'desc'), limit(1));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          const data = snapshot.docs[0].data();
          const date = data.startDate?.toDate
            ? data.startDate.toDate()
            : data.startDate?.seconds
            ? new Date(data.startDate.seconds * 1000)
            : null;
          if (date) setStartDate(date);
        }
      } catch (e) {
        console.error('Failed to load campaign startDate:', e);
      }
    })();
  }, []);

  // revoke object URLs on unmount
  useEffect(() => {
    return () => {
      images.forEach((f) => {
        if (typeof f !== 'string' && f?.preview) URL.revokeObjectURL(f.preview);
      });
    };
  }, [images]);

  // ---------- Helpers ----------
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

  const toggleFeature = (feature) => {
    setFeatures((prev) => ({ ...prev, [feature]: !prev[feature] }));
  };

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

    setAddress(areaAddress || null);
    setFormattedAddress(fullFormatted || null);

    if (lat && lng) {
      setLocation({ latitude: lat, longitude: lng });
    }
  };

  const [imageDragging, setImageDragging] = useState(false);

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files || []);
    const newImages = files.map((file) => {
      const f = file;
      f.preview = URL.createObjectURL(file);
      return f;
    });
    setImages((prev) => [...prev, ...newImages]);
  };

  const handleImageDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setImageDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    const newImages = files.map((file) => {
      file.preview = URL.createObjectURL(file);
      return file;
    });
    setImages((prev) => [...prev, ...newImages]);
  };

  const removeImage = (index) => {
    setImages((prev) => {
      const newImages = [...prev];
      const removed = newImages.splice(index, 1)[0];
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return newImages;
    });
  };

  const resetForm = () => {
    setStep(STEPS.INTRO);
    setPropertyId(null);
    setAddress(null);
    setType(null);
    setPriceRaw('');
    setBathrooms('');
    setBedrooms('');
    setCarSpaces('');
    setSquareFootage('');
    setTitle('');
    setDescription('');
    setLocation(null);
    setFeatures({});
    setImages([]);
    setErrors({});
    setGotoMarketGoal(null);
    setFullName('');
    setClientEmail('');
    setPhone('');
  };

  const closeModal = () => {
    resetForm();
    setShowModal(false);
  };

  // ---------- Validation ----------
  const validateStep = () => {
    const newErrors = {};

    if (step === STEPS.INTRO) {
      if (!clientName || !clientEmail || !clientPhone) {
        newErrors.step = 'Please fill in all fields';
      }
    }

    if (step === STEPS.GOAL) {
      if (!gotoMarketGoal?.date) {
        newErrors.step = 'Please choose a rough timeline.';
      }
    }

    if (step === STEPS.ADDRESS) {
      if (!address || !location?.latitude || !location?.longitude) {
        newErrors.step = 'Please select a valid address from suggestions.';
      }
    }

    if (step === STEPS.TYPE && !type) {
      newErrors.step = 'Please select a property type.';
    }

    if (step === STEPS.PRICE && !priceRaw) {
      newErrors.step = 'Please enter your expected price.';
    }

    if (step === STEPS.DETAILS) {
      if (!bedrooms || !bathrooms || !carSpaces) {
        newErrors.step = 'Please add bedrooms, bathrooms and car spaces.';
      }
    }

    if (step === STEPS.IMAGES && images.length === 0) {
      newErrors.step = 'Please upload at least one image.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // ---------- Navigation ----------
  const handlePriorSubmitIfNeeded = async () => {
    if (step !== STEPS.INTRO) return;
    if (!userId) throw new Error('Missing user ID. Please reload and try again.');

    const propertyData = {
      createdAt: serverTimestamp(),
      offPlan: false,
      priceHistory: [],
      showPriceRange: false,
      squareFootage,
      active: false,
      isEager: 0,
      wantsPremiumListing: false,
      agent: true,
      clientName,
      clientEmail,
      clientPhone,
      userId: userId,
    };

    const docRef = await addDoc(collection(db, 'properties'), propertyData);
    setPropertyId(docRef.id);
  };

  const onNext = async () => {
    setErrors({});
    if (navLoading) return;
    const ok = validateStep();
    if (!ok) return;

    setNavLoading(true);
    try {
      await handlePriorSubmitIfNeeded();
      setStep((s) => s + 1);
    } catch (e) {
      console.error('Failed advancing step:', e);
      setErrors({ step: 'Something went wrong. Please try again.' });
    } finally {
      setNavLoading(false);
    }
  };

  const onBack = () => {
    if (step > STEPS.INTRO && step < STEPS.COMPLETE) {
      setErrors({});
      setStep((s) => s - 1);
    }
  };

  // ---------- Submit ----------
  const handleSubmit = async () => {
    setErrors({});
    if (!validateStep()) return;

    if (!userId) {
      setErrors({ step: 'Missing user ID. Please refresh and try again.' });
      return;
    }
    if (!propertyId) {
      setErrors({ step: 'Property not created yet. Please go back a step and try again.' });
      return;
    }

    try {
      setIsSubmitting(true);

      const total = images.length;
      const imageUrls = [];

      await updateDoc(doc(db, 'properties', propertyId), {
        userId: userId,
        createdAt: serverTimestamp(),
        imageUploadProgress: {
          uploaded: 0,
          total,
          inProgress: total > 0,
        },
      });

      for (let i = 0; i < total; i++) {
        const file = images[i];
        const storageRef = ref(storage, `propertyImages/${userId}/${Date.now()}-${file.name}`);
        const uploadTask = uploadBytesResumable(storageRef, file);

        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve, reject) => {
          uploadTask.on(
            'state_changed',
            null,
            reject,
            async () => {
              const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
              imageUrls.push(downloadURL);
              await updateDoc(doc(db, 'properties', propertyId), {
                imageUploadProgress: {
                  uploaded: imageUrls.length,
                  total,
                  inProgress: imageUrls.length < total,
                },
              });
              resolve();
            }
          );
        });
      }

      const propertyData = {
        address,
        formattedAddress,
        bathrooms,
        bedrooms,
        carSpaces,
        createdAt: serverTimestamp(),
        description,
        imageUrls,
        imageUploadProgress: { uploaded: total, total, inProgress: false },
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
        isEager: 0,
        propertyType: type,
        wantsPremiumListing: false,
        agent: true,
        gotoMarketGoal: gotoMarketGoal?.date || null,
        clientName,
        clientEmail,
        clientPhone,
        vendorUploaded: true,
        agentManaged: true,
        userId: userId,
      };

      await updateDoc(doc(db, 'properties', propertyId), propertyData);
      await setDoc(doc(db, 'draftProperties', propertyId), { ...propertyData, override: true });

      // Only a small allowlist of contact fields is copied into the
      // notification — never the whole user document (see pickNotificationUser).
      // The agent's document may not be readable from this session, in which
      // case the notification just carries the uid.
      let notificationUser = pickNotificationUser({}, userId);
      try {
        const userSnap = await getDoc(doc(db, 'users', userId));
        if (userSnap.exists()) notificationUser = pickNotificationUser(userSnap.data(), userId);
      } catch (err) {
        console.warn('Could not read agent for notification; using uid only');
      }

      await addDoc(collection(db, 'notifications'), {
        property: propertyData,
        createdAt: new Date(),
        read: false,
        type: 'newProspect',
        user: notificationUser,
      });

      setStep(STEPS.COMPLETE);
    } catch (err) {
      console.error('Submit failed:', err);
      setErrors({ step: 'Something went wrong. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---------- Render ----------
  const progressSteps = 7;
  const progressPercent = (Math.min(step, progressSteps) / progressSteps) * 100;

  const StepIcon = STEP_ICONS[step];

  return (
    <div className={isHidden ? 'hidden' : 'fixed overflow-hidden z-50 w-full top-0 left-0 h-screen bg-gray-50'}>
      <div className="overflow-y-scroll overflow-x-hidden fixed inset-0 z-50 flex flex-col">
        {/* Modern Header */}
        <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="container mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shadow-lg">
                  {StepIcon && <StepIcon className="w-6 h-6 text-white" />}
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">List Your Property</h1>
                  <p className="text-sm text-gray-500">
                    Step {step} of {progressSteps}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="w-10 h-10 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            {/* Progress Bar */}
            {step < STEPS.COMPLETE && (
              <div className="mt-4 w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-orange-400 to-orange-600"
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 container mx-auto px-6 py-8 max-w-3xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              {/* Step 1: Intro */}
              {step === STEPS.INTRO && (
                <div className="space-y-6">
                  <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200">
                    <div className="mb-6">
                      <h2 className="text-3xl font-bold text-gray-900 mb-3">Welcome! 👋</h2>
                      <p className="text-gray-600 text-lg leading-relaxed">
                        Let's get started by collecting some basic information about you.
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Full Name</label>
                        <input
                          type="text"
                          placeholder="John Smith"
                          value={clientName}
                          onChange={(e) => setFullName(e.target.value)}
                          className="w-full px-4 py-4 rounded-xl border-2 border-gray-200 focus:border-orange-400 focus:ring-0 outline-none transition-colors text-gray-900 placeholder-gray-400"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Email Address</label>
                        <input
                          type="email"
                          placeholder="john@example.com"
                          value={clientEmail}
                          onChange={(e) => setClientEmail(e.target.value)}
                          className="w-full px-4 py-4 rounded-xl border-2 border-gray-200 focus:border-orange-400 focus:ring-0 outline-none transition-colors text-gray-900 placeholder-gray-400"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Phone Number</label>
                        <input
                          type="tel"
                          placeholder="0400 000 000"
                          value={clientPhone}
                          onChange={(e) => setPhone(e.target.value)}
                          className="w-full px-4 py-4 rounded-xl border-2 border-gray-200 focus:border-orange-400 focus:ring-0 outline-none transition-colors text-gray-900 placeholder-gray-400"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Goal */}
              {step === STEPS.GOAL && (
                <div className="space-y-6">
                  <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200">
                    <div className="mb-6">
                      <h2 className="text-3xl font-bold text-gray-900 mb-3">When are you thinking of selling?</h2>
                      <p className="text-gray-600 text-lg">Pick a rough timeframe that works for you.</p>
                    </div>

                    <div className="space-y-3">
                      {GOAL_OPTIONS.map((option) => (
                        <button
                          key={option.label}
                          onClick={() => {
                            const d = new Date();
                            d.setMonth(d.getMonth() + option.months);
                            setGotoMarketGoal({
                              label: option.label,
                              months: option.months,
                              date: d,
                              ts: d.getTime(),
                            });
                          }}
                          className={`w-full px-6 py-5 rounded-2xl text-left font-medium transition-all duration-200 border-2 ${
                            gotoMarketGoal?.label === option.label
                              ? 'bg-gradient-to-r from-orange-400 to-orange-500 text-white border-orange-500 shadow-lg scale-[1.02]'
                              : 'bg-white text-gray-700 border-gray-200 hover:border-orange-300 hover:shadow-md'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-lg">{option.label}</span>
                            {gotoMarketGoal?.label === option.label && (
                              <Check className="w-6 h-6" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Address */}
              {step === STEPS.ADDRESS && (
                <div className="space-y-6">
                  <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200">
                    <div className="mb-6">
                      <h2 className="text-3xl font-bold text-gray-900 mb-3">Where's your property?</h2>
                      <p className="text-gray-600 text-lg">Start typing and select from the suggestions.</p>
                    </div>

                    <LoadScript
                      id="gmaps-script"
                      googleMapsApiKey="AIzaSyBbLrFWUU62O_by81ihAVKvye4bHA0sah8"
                      libraries={['places']}
                    >
                      <Autocomplete onLoad={(ref) => (autocompleteRef.current = ref)} onPlaceChanged={handlePlaceChanged}>
                        <div className="relative">
                          <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                          <input
                            type="text"
                            placeholder="123 Main Street, Sydney NSW"
                            className="w-full pl-12 pr-4 py-5 rounded-2xl border-2 border-gray-200 focus:border-orange-400 focus:ring-0 outline-none transition-colors text-gray-900 placeholder-gray-400 text-lg"
                          />
                        </div>
                      </Autocomplete>
                    </LoadScript>

                    {address && (
                      <div className="mt-4 p-4 bg-orange-50 rounded-xl border border-orange-200">
                        <p className="text-sm text-orange-800">
                          <strong>Selected:</strong> {formattedAddress}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 4: Type */}
              {step === STEPS.TYPE && (
                <div className="space-y-6">
                  <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200">
                    <div className="mb-6">
                      <h2 className="text-3xl font-bold text-gray-900 mb-3">What type of property is it?</h2>
                      <p className="text-gray-600 text-lg">Choose the one that fits best.</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {homeTypes.map((item, idx) => (
                        <button
                          key={idx}
                          onClick={() => setType(idx + 1)}
                          className={`px-6 py-5 rounded-2xl text-lg font-medium transition-all duration-200 border-2 ${
                            type === idx + 1
                              ? 'bg-gradient-to-r from-orange-400 to-orange-500 text-white border-orange-500 shadow-lg scale-[1.02]'
                              : 'bg-white text-gray-700 border-gray-200 hover:border-orange-300 hover:shadow-md'
                          }`}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 5: Price */}
              {step === STEPS.PRICE && (
                <div className="space-y-6">
                  <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200">
                    <div className="mb-6">
                      <h2 className="text-3xl font-bold text-gray-900 mb-3">What's your expected price?</h2>
                      <p className="text-gray-600 text-lg">Give us a ballpark figure.</p>
                    </div>

                    <div className="relative">
                      <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-400" />
                      <input
                        type="text"
                        placeholder="750,000"
                        value={formattedPrice}
                        onChange={(e) => {
                          const numeric = (e.target.value || '').replace(/\D/g, '');
                          setPriceRaw(numeric);
                        }}
                        className="w-full pl-12 pr-4 py-5 rounded-2xl border-2 border-gray-200 focus:border-orange-400 focus:ring-0 outline-none transition-colors text-gray-900 placeholder-gray-400 text-2xl font-semibold"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 6: Details */}
              {step === STEPS.DETAILS && (
                <div className="space-y-6">
                  <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200">
                    <div className="mb-6">
                      <h2 className="text-3xl font-bold text-gray-900 mb-3">Tell us more about your property</h2>
                      <p className="text-gray-600 text-lg">The basic details.</p>
                    </div>

                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">Bedrooms</label>
                          <input
                            type="number"
                            placeholder="3"
                            value={bedrooms}
                            onChange={(e) => setBedrooms(e.target.value)}
                            className="w-full px-4 py-4 rounded-xl border-2 border-gray-200 focus:border-orange-400 focus:ring-0 outline-none transition-colors text-gray-900 placeholder-gray-400 text-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">Bathrooms</label>
                          <input
                            type="number"
                            placeholder="2"
                            value={bathrooms}
                            onChange={(e) => setBathrooms(e.target.value)}
                            className="w-full px-4 py-4 rounded-xl border-2 border-gray-200 focus:border-orange-400 focus:ring-0 outline-none transition-colors text-gray-900 placeholder-gray-400 text-lg"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">Car Spaces</label>
                          <input
                            type="number"
                            placeholder="2"
                            value={carSpaces}
                            onChange={(e) => setCarSpaces(e.target.value)}
                            className="w-full px-4 py-4 rounded-xl border-2 border-gray-200 focus:border-orange-400 focus:ring-0 outline-none transition-colors text-gray-900 placeholder-gray-400 text-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">Square Footage</label>
                          <input
                            type="number"
                            placeholder="2500"
                            value={squareFootage}
                            onChange={(e) => setSquareFootage(e.target.value)}
                            className="w-full px-4 py-4 rounded-xl border-2 border-gray-200 focus:border-orange-400 focus:ring-0 outline-none transition-colors text-gray-900 placeholder-gray-400 text-lg"
                          />
                        </div>
                      </div>

                      <div className="pt-4">
                        <label className="block text-sm font-semibold text-gray-700 mb-3">Features (Optional)</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {homeFeatures.map((feature, i) => (
                            <button
                              key={i}
                              onClick={() => toggleFeature(feature)}
                              className={`px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 border-2 ${
                                features[feature]
                                  ? 'bg-gradient-to-r from-orange-400 to-orange-500 text-white border-orange-500'
                                  : 'bg-white text-gray-700 border-gray-200 hover:border-orange-300'
                              }`}
                            >
                              {feature}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 7: Images */}
              {step === STEPS.IMAGES && (
                <div className="space-y-6">
                  <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200">
                    <div className="mb-6">
                      <h2 className="text-3xl font-bold text-gray-900 mb-3">Add some photos</h2>
                      <p className="text-gray-600 text-lg">Show off your property with great images.</p>
                    </div>

                    <div
                      onDragOver={(e) => { e.preventDefault(); setImageDragging(true); }}
                      onDragLeave={() => setImageDragging(false)}
                      onDrop={handleImageDrop}
                      onClick={() => document.getElementById('images').click()}
                      className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-200 ${imageDragging ? 'border-orange-400 bg-orange-50 scale-[1.02]' : 'border-gray-300 hover:border-orange-400 hover:bg-orange-50'}`}
                    >
                      <ImageIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-lg font-semibold text-gray-900 mb-2">Click or drag and drop images</p>
                      <p className="text-sm text-gray-500">JPG, PNG up to 10MB each</p>
                      <input
                        type="file"
                        name="images"
                        id="images"
                        accept="image/*"
                        multiple
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                    </div>

                    {images.length > 0 && (
                      <div className="mt-6">
                        <p className="text-sm font-semibold text-gray-700 mb-3">{images.length} image(s) uploaded</p>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                          {images.map((img, i) => {
                            const src = typeof img === 'string' ? img : img?.preview;
                            if (!src) return null;
                            return (
                              <div key={i} className="relative group">
                                <Image
                                  src={src}
                                  width={200}
                                  height={200}
                                  className="w-full h-32 object-cover rounded-xl border-2 border-gray-200"
                                  alt={`upload-${i}`}
                                />
                                <button
                                  onClick={() => removeImage(i)}
                                  className="absolute top-2 right-2 w-8 h-8 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 8: Complete */}
              {step === STEPS.COMPLETE && (
                <div className="min-h-[60vh] flex items-center justify-center">
                  <div className="bg-white rounded-3xl p-12 shadow-sm border border-gray-200 text-center max-w-2xl">
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center mx-auto mb-6">
                      <Check className="w-10 h-10 text-white" />
                    </div>

                    <h2 className="text-4xl font-bold text-gray-900 mb-4">Property Submitted</h2>
                    <p className="text-lg text-gray-600 mb-8 leading-relaxed max-w-xl mx-auto">
                      Your property details have been submitted successfully. Your agent will review everything and be in touch with next steps.
                    </p>

                    <button
                      onClick={closeModal}
                      className="px-8 py-4 bg-gradient-to-r from-orange-400 to-orange-600 text-white font-semibold rounded-2xl hover:shadow-lg transition-all duration-200"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}

              {/* Error Message */}
              {errors.step && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6 bg-red-50 border-2 border-red-200 rounded-2xl p-4 text-center"
                >
                  <p className="text-red-800 font-medium">{errors.step}</p>
                </motion.div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation Buttons */}
        {step < STEPS.COMPLETE && (
          <div className="bg-white border-t border-gray-200 sticky bottom-0 z-10">
            <div className="container mx-auto px-6 py-4 max-w-3xl">
              <div className="flex justify-between items-center">
                {step > STEPS.INTRO ? (
                  <button
                    onClick={onBack}
                    className="px-6 py-3 rounded-xl bg-gray-100 text-gray-700 font-semibold hover:bg-gray-200 transition-colors"
                  >
                    Back
                  </button>
                ) : (
                  <div />
                )}

                {step < STEPS.IMAGES ? (
                  <button
                    onClick={onNext}
                    disabled={navLoading}
                    className="px-8 py-4 bg-gradient-to-r from-orange-400 to-orange-600 text-white font-semibold rounded-xl hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {navLoading ? 'Loading...' : 'Continue'}
                  </button>
                ) : (
                  <button
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className="px-8 py-4 bg-gradient-to-r from-orange-400 to-orange-600 text-white font-semibold rounded-xl hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit Property'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Uploading Overlay */}
        {isSubmitting && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-3xl p-12 shadow-2xl text-center max-w-md">
              <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">Uploading your property...</h2>
              <p className="text-gray-600">Please wait while we save your listing and upload your images.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}