'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  X,
  MapPin,
  Wallet,
  Home as HomeIcon,
  Clock,
  Target,
} from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import { authFetch } from '../../utils/authFetch';
import { db } from '../../firebase/clientApp';
import { getSafeReturnTo } from '../../utils/safeRedirect';
import LocationSearch from '../../dashboard/playground/components/LocationSearch';

const BUYER_TYPE_OPTIONS = [
  { id: 'cashBuyer', label: 'Cash buyer' },
  { id: 'investor', label: 'Investor' },
  { id: 'firstHomeBuyer', label: 'First home buyer' },
  { id: 'upgrader', label: 'Upgrader' },
  { id: 'browsing', label: 'Just browsing' },
];

const PROPERTY_TYPE_OPTIONS = ['House', 'Apartment', 'Townhouse', 'Land'];
const BEDROOM_OPTIONS = [
  { id: 0, label: 'Any' },
  { id: 1, label: '1' },
  { id: 2, label: '2' },
  { id: 3, label: '3' },
  { id: 4, label: '4' },
  { id: 5, label: '5+' },
];
const TIMELINE_OPTIONS = [
  { id: 'ready_now', label: 'Ready now' },
  { id: '1_3m', label: '1–3 months' },
  { id: '3_6m', label: '3–6 months' },
  { id: '6_12m', label: '6–12 months' },
  { id: '12m_plus', label: '12+ months' },
];

const STEPS = [
  { id: 1, icon: Target, label: 'About you' },
  { id: 2, icon: Wallet, label: 'Budget & type' },
  { id: 3, icon: MapPin, label: 'Areas' },
  { id: 4, icon: Clock, label: 'Timeline' },
  { id: 5, icon: HomeIcon, label: 'Goals' },
];

function formatCurrency(n) {
  if (!n && n !== 0) return '';
  return `$${Number(n).toLocaleString()}`;
}

const chipBase =
  'px-4 py-2.5 rounded-full text-sm font-medium border transition-all';
const chipSelected =
  'bg-orange-500 border-orange-500 text-white shadow-md shadow-orange-500/20';
const chipUnselected =
  'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50';

function WizardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, userData, loading, setUserData } = useAuth();
  // SECURITY: this is the actual open-redirect SINK — router.replace()
  // below used to receive this raw value with no validation at all,
  // reachable either via signup/page.js's own (now also validated)
  // pass-through, or directly by visiting this page with a crafted
  // ?returnTo= param. See safeRedirect.js.
  const returnTo = getSafeReturnTo(searchParams.get('returnTo')) || '';

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Step 1
  const [buyerTypes, setBuyerTypes] = useState([]);
  // Step 2
  const [budgetMin, setBudgetMin] = useState(500_000);
  const [budgetMax, setBudgetMax] = useState(1_500_000);
  const [propertyTypes, setPropertyTypes] = useState(['House']);
  const [bedroomsMin, setBedroomsMin] = useState(0);
  // Step 3
  const [radius, setRadius] = useState(5);
  const [areas, setAreas] = useState([]);
  // Step 4
  const [timeline, setTimeline] = useState('3_6m');
  // Step 5
  const [objectives, setObjectives] = useState('');
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyInApp, setNotifyInApp] = useState(true);

  // Redirect out if not logged in
  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  const progress = useMemo(() => (step / STEPS.length) * 100, [step]);

  const toggleBuyerType = (id) => {
    setBuyerTypes((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const togglePropertyType = (id) => {
    setPropertyTypes((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const addArea = (loc) => {
    if (!loc) return;
    if (areas.length >= 10) return;
    if (areas.some((a) => a.placeName === loc.placeName)) return;
    setAreas((prev) => [...prev, { ...loc, radiusKm: radius }]);
  };

  const removeArea = (idx) => {
    setAreas((prev) => prev.filter((_, i) => i !== idx));
  };

  const buildProfilePayload = () => ({
    buyerTypes,
    budgetMin,
    budgetMax,
    propertyTypes,
    bedroomsMin,
    timeline,
    objectives,
    notify: { email: notifyEmail, inApp: notifyInApp },
    onboardingComplete: true,
    skipped: false,
  });

  const saveProfile = async (patch) => {
    const res = await authFetch('/api/buyer/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || 'Failed to save profile');
    }
    return res.json();
  };

  const saveAreas = async () => {
    for (const area of areas) {
      await authFetch('/api/buyer/watched-areas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: area.name,
          placeName: area.placeName,
          suburb: area.suburb || null,
          state: area.state || null,
          lat: area.lat,
          lng: area.lng,
          placeType: area.placeType || 'locality',
          radiusKm: area.radiusKm ?? 5,
        }),
      });
    }
  };

  // Re-fetch the user doc from Firestore so the AuthContext reflects the
  // wizard's writes BEFORE we navigate. This prevents the dashboard layout
  // from seeing stale userData and bouncing the user back into the wizard.
  const refreshUserData = async () => {
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        setUserData?.({ id: snap.id, ...snap.data() });
      }
    } catch (err) {
      console.error('Failed to refresh user data after wizard:', err);
    }
  };

  const finish = async () => {
    setSubmitting(true);
    setError('');
    try {
      await saveProfile(buildProfilePayload());
      if (areas.length > 0) {
        await saveAreas();
      }
      await refreshUserData();
      router.replace(returnTo || '/buyer-dashboard');
    } catch (err) {
      console.error('Wizard finish error:', err);
      setError('Could not save your preferences. Please try again.');
      setSubmitting(false);
    }
  };

  const skip = async () => {
    setSubmitting(true);
    setError('');
    try {
      await saveProfile({
        onboardingComplete: true,
        skipped: true,
      });
      await refreshUserData();
      router.replace(returnTo || '/buyer-dashboard');
    } catch (err) {
      console.error('Skip error:', err);
      setError('Could not skip onboarding. Please try again.');
      setSubmitting(false);
    }
  };

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length));
  const back = () => setStep((s) => Math.max(s - 1, 1));

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-orange-50/30" />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-orange-50/30 flex items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-2xl"
      >
        {/* Progress stepper */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            {STEPS.map((s) => {
              const Icon = s.icon;
              const isActive = step === s.id;
              const isDone = step > s.id;
              return (
                <div
                  key={s.id}
                  className="flex flex-col items-center flex-1"
                >
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center border transition-all ${
                      isDone
                        ? 'bg-orange-500 border-orange-500 text-white'
                        : isActive
                        ? 'bg-white border-orange-500 text-orange-600 shadow-md shadow-orange-500/10'
                        : 'bg-white border-slate-200 text-slate-400'
                    }`}
                  >
                    {isDone ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Icon className="w-4 h-4" />
                    )}
                  </div>
                  <span
                    className={`text-[10px] mt-2 hidden sm:block font-medium ${
                      isActive ? 'text-orange-600' : isDone ? 'text-slate-600' : 'text-slate-400'
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-orange-500 to-amber-500"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.4 }}
            />
          </div>
        </div>

        {/* Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-10 shadow-2xl shadow-slate-900/5">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.25 }}
            >
              {step === 1 && (
                <div>
                  <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
                    What best describes you?
                  </h2>
                  <p className="text-slate-600 mb-6">
                    Pick any that apply — we&apos;ll tailor your dashboard to match.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {BUYER_TYPE_OPTIONS.map((opt) => {
                      const selected = buyerTypes.includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => toggleBuyerType(opt.id)}
                          className={`${chipBase} ${
                            selected ? chipSelected : chipUnselected
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {step === 2 && (
                <div>
                  <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
                    Budget &amp; property type
                  </h2>
                  <p className="text-slate-600 mb-6">
                    Roughly what are you looking for?
                  </p>

                  {/* Budget breakout box (intentionally dark for emphasis) */}
                  <div className="mb-6 rounded-xl bg-slate-950 border border-slate-800 p-5">
                    <div className="flex items-baseline justify-between mb-4">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">
                        Budget Range
                      </span>
                      <span className="text-lg font-mono text-orange-400 font-semibold">
                        {formatCurrency(budgetMin)} – {formatCurrency(budgetMax)}
                      </span>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <span className="text-[10px] text-slate-500 mb-1 block uppercase tracking-wider">
                          Min
                        </span>
                        <input
                          type="range"
                          min={100_000}
                          max={5_000_000}
                          step={50_000}
                          value={budgetMin}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setBudgetMin(v);
                            if (v > budgetMax) setBudgetMax(v);
                          }}
                          className="w-full accent-orange-500"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 mb-1 block uppercase tracking-wider">
                          Max
                        </span>
                        <input
                          type="range"
                          min={100_000}
                          max={5_000_000}
                          step={50_000}
                          value={budgetMax}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setBudgetMax(v);
                            if (v < budgetMin) setBudgetMin(v);
                          }}
                          className="w-full accent-orange-500"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mb-6">
                    <label className="block text-xs uppercase tracking-wider text-slate-500 mb-3 font-semibold">
                      Property type
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {PROPERTY_TYPE_OPTIONS.map((p) => {
                        const selected = propertyTypes.includes(p);
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => togglePropertyType(p)}
                            className={`${chipBase} ${
                              selected ? chipSelected : chipUnselected
                            }`}
                          >
                            {p}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs uppercase tracking-wider text-slate-500 mb-3 font-semibold">
                      Minimum bedrooms
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {BEDROOM_OPTIONS.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setBedroomsMin(b.id)}
                          className={`${chipBase} ${
                            bedroomsMin === b.id ? chipSelected : chipUnselected
                          }`}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div>
                  <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
                    Which areas are you watching?
                  </h2>
                  <p className="text-slate-600 mb-6">
                    Add up to 10 suburbs, cities, or specific addresses.
                  </p>
                  <div className="relative z-50">
                    <LocationSearch
                      variant="light"
                      onLocationSelect={addArea}
                      searchRadius={radius}
                      onRadiusChange={setRadius}
                    />
                  </div>
                  {areas.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {areas.map((a, idx) => (
                        <div
                          key={`${a.placeName}-${idx}`}
                          className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-full pl-3 pr-1 py-1"
                        >
                          <MapPin className="w-3 h-3 text-orange-600" />
                          <span className="text-xs text-slate-800 font-medium">
                            {a.name || a.placeName}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeArea(idx)}
                            className="w-5 h-5 rounded-full flex items-center justify-center text-slate-500 hover:text-white hover:bg-orange-500"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-slate-500 mt-3 font-mono">
                    {areas.length}/10 selected
                  </p>
                </div>
              )}

              {step === 4 && (
                <div>
                  <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
                    When are you looking to buy?
                  </h2>
                  <p className="text-slate-600 mb-6">
                    Helps us flag properties that match your timing.
                  </p>
                  <div className="space-y-2">
                    {TIMELINE_OPTIONS.map((t) => {
                      const selected = timeline === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setTimeline(t.id)}
                          className={`w-full flex items-center justify-between px-5 py-3 rounded-xl border transition-all ${
                            selected
                              ? 'bg-orange-500 border-orange-500 text-white shadow-md shadow-orange-500/20'
                              : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <span className="font-medium">{t.label}</span>
                          {selected && <Check className="w-4 h-4" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {step === 5 && (
                <div>
                  <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
                    What&apos;s important to you?
                  </h2>
                  <p className="text-slate-600 mb-6">
                    Schools, commute, yard, view… anything that matters.
                  </p>
                  <textarea
                    value={objectives}
                    onChange={(e) => setObjectives(e.target.value)}
                    rows={4}
                    placeholder="Good schools, close to public transport, big backyard..."
                    className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
                  />
                  <div className="mt-6 space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={notifyEmail}
                        onChange={(e) => setNotifyEmail(e.target.checked)}
                        className="w-4 h-4 accent-orange-500"
                      />
                      <span className="text-sm text-slate-700">
                        Email me when new properties match
                      </span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={notifyInApp}
                        onChange={(e) => setNotifyInApp(e.target.checked)}
                        className="w-4 h-4 accent-orange-500"
                      />
                      <span className="text-sm text-slate-700">
                        Show in-app notifications
                      </span>
                    </label>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {error && (
            <div className="mt-6 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Nav */}
          <div className="mt-10 flex items-center justify-between">
            <button
              type="button"
              onClick={back}
              disabled={step === 1 || submitting}
              className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 disabled:opacity-30 font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <button
              type="button"
              onClick={skip}
              disabled={submitting}
              className="text-sm text-slate-400 hover:text-slate-600 disabled:opacity-30 font-medium"
            >
              Skip for now
            </button>

            {step < STEPS.length ? (
              <button
                type="button"
                onClick={next}
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white font-semibold text-sm rounded-xl hover:shadow-lg hover:shadow-orange-500/30 transition-all disabled:opacity-50"
              >
                Next
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={finish}
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white font-semibold text-sm rounded-xl hover:shadow-lg hover:shadow-orange-500/30 transition-all disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Finish'}
                <Check className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function BuyerWelcomePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-orange-50/30" />
      }
    >
      <WizardInner />
    </Suspense>
  );
}
