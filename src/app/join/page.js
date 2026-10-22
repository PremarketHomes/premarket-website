'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { auth, db } from '../firebase/clientApp';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AuthShell from '../components/public-site/AuthShell';
import { authFetch } from '../utils/authFetch';
import {
  AUTH_LABEL_CLASS,
  AUTH_INPUT_CLASS,
  AUTH_SUBMIT_CLASS,
  AUTH_ERROR_CLASS,
  AUTH_LINK_CLASS,
} from '../components/public-site/authFieldStyles';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AgentSignup() {
  const router = useRouter();
  // Option A (default): the existing individual-agent flow, completely
  // unchanged below. Option B: a real estate OFFICE registers once —
  // the person submitting becomes that office's initial administrator
  // and is taken to the Office Management dashboard instead of the
  // normal agent dashboard. Independent agents never see or interact
  // with any of the office-specific code added for Option B.
  const [signupType, setSignupType] = useState('agent'); // 'agent' | 'office'

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
    countryCode: '+61',
    agencyName: '',
    billingContactName: '',
    billingEmail: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [officeFormData, setOfficeFormData] = useState({
    officeName: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    countryCode: '+61',
    password: '',
    confirmPassword: '',
  });
  const [officeLoading, setOfficeLoading] = useState(false);
  const [officeError, setOfficeError] = useState('');

  const countryCodes = [
    { code: '+61', country: 'AU', flag: '🇦🇺' },
    { code: '+1', country: 'US', flag: '🇺🇸' },
    { code: '+44', country: 'UK', flag: '🇬🇧' },
    { code: '+64', country: 'NZ', flag: '🇳🇿' },
    { code: '+65', country: 'SG', flag: '🇸🇬' },
  ];

  const formatPhoneNumber = (value) => {
    // Remove all non-digits
    const digits = value.replace(/\D/g, '');

    // Format as XXX XXX XXX for Australian numbers
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`;
  };

  const handlePhoneChange = (e) => {
    const formatted = formatPhoneNumber(e.target.value);
    setFormData({ ...formData, phone: formatted });
  };

  const handleOfficePhoneChange = (e) => {
    const formatted = formatPhoneNumber(e.target.value);
    setOfficeFormData({ ...officeFormData, phone: formatted });
  };

  const handleOfficeSubmit = async (e) => {
    e.preventDefault();
    setOfficeError('');

    if (officeFormData.password !== officeFormData.confirmPassword) {
      setOfficeError('Passwords do not match');
      return;
    }
    if (officeFormData.password.length < 6) {
      setOfficeError('Password must be at least 6 characters');
      return;
    }
    const phoneDigits = officeFormData.phone.replace(/\D/g, '');
    if (phoneDigits.length < 9) {
      setOfficeError('Please enter a valid phone number');
      return;
    }
    if (!officeFormData.officeName.trim()) {
      setOfficeError('Office name is required');
      return;
    }

    setOfficeLoading(true);
    try {
      // Same client-side account-creation pattern as the individual
      // agent flow above (createUserWithEmailAndPassword + a plain
      // setDoc of only the fields every signup already writes) — the
      // office-specific part (creating the offices doc and linking
      // officeId/isOfficeAdmin) is deliberately a SEPARATE, server-only
      // follow-up call (POST /api/offices), since those fields are not
      // in the client's own write allowlist (see firestore.rules).
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        officeFormData.email,
        officeFormData.password
      );
      const user = userCredential.user;
      const fullPhone = `${officeFormData.countryCode}${phoneDigits}`;

      await setDoc(doc(db, 'users', user.uid), {
        activeCampaigns: 0,
        availableCampaigns: 9999,
        avatar: 'https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png?20150327203541',
        buyerMetrics: { budget: 0, cashBuyer: false, investor: false },
        created: Timestamp.now(),
        email: officeFormData.email.toLowerCase(),
        firstName: officeFormData.firstName.trim(),
        lastName: officeFormData.lastName.trim(),
        phone: fullPhone,
        companyName: officeFormData.officeName.trim(),
        mobileConfirmedAt: Timestamp.now(),
        pro: true,
        agent: true,
        active: true,
        roles: ['agent'],
        showLeaderboard: true,
        tags: ['new', 'office-admin'],
        updatedAt: Timestamp.now(),
      });

      const res = await authFetch('/api/offices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: officeFormData.officeName.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to register office');

      if (body.status === 'exists') {
        // An office with this exact name already exists — never
        // silently duplicated or joined. The account above is still a
        // completely normal, working individual agent account; a
        // join request has been filed for manual follow-up.
        router.push('/dashboard?officeRequestPending=1');
        return;
      }

      router.push('/dashboard/office');
    } catch (err) {
      console.error('Office signup error:', err);
      if (err.code === 'auth/email-already-in-use') {
        setOfficeError('An account with this email already exists');
      } else if (err.code === 'auth/invalid-email') {
        setOfficeError('Please enter a valid email address');
      } else {
        setOfficeError(err.message || 'Something went wrong. Please try again.');
      }
    } finally {
      setOfficeLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    const phoneDigits = formData.phone.replace(/\D/g, '');
    if (phoneDigits.length < 9) {
      setError('Please enter a valid phone number');
      return;
    }

    if (!formData.billingEmail.trim() || !EMAIL_RE.test(formData.billingEmail.trim())) {
      setError('Please enter a valid billing email address');
      return;
    }

    setLoading(true);

    try {
      // Create Firebase Auth user
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        formData.email,
        formData.password
      );

      const user = userCredential.user;
      const fullPhone = `${formData.countryCode}${phoneDigits}`;

      // Create Firestore user document
      await setDoc(doc(db, 'users', user.uid), {
        activeCampaigns: 0,
        availableCampaigns: 9999,
        avatar: 'https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png?20150327203541',
        buyerMetrics: {
          budget: 0,
          cashBuyer: false,
          investor: false,
        },
        created: Timestamp.now(),
        email: formData.email.toLowerCase(),
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        phone: fullPhone,
        companyName: formData.agencyName.trim(),
        // Onboarding just captured and validated this number, so there's
        // nothing to re-confirm later — prevents the dashboard's mobile
        // confirmation prompt from firing for brand-new agents.
        mobileConfirmedAt: Timestamp.now(),
        pro: true,
        agent: true,
        active: true,
        roles: ['agent'],
        showLeaderboard: true,
        tags: ['new'],
        updatedAt: Timestamp.now(),
      });

      // Store uid in session storage for later
      sessionStorage.setItem('agentSignupUid', user.uid);

      // Submit billing details now that companyName is written and
      // the account has a valid session — files a pending proposal
      // under this agent's own UID, awaiting one superAdmin review
      // (see /api/agency/propose-billing-contact). Never blocks
      // account usability: a failure here is logged but the agent
      // still reaches their dashboard immediately — this can also be
      // completed later from the dashboard banner if it fails here.
      try {
        await authFetch('/api/agency/propose-billing-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            billingName: formData.agencyName.trim() || undefined,
            contactName: formData.billingContactName.trim(),
            contactEmail: formData.billingEmail.trim(),
          }),
        });
      } catch (billingErr) {
        console.error('Signup billing-details submission failed (non-blocking):', billingErr);
      }

      // Auto-establish/inherit agency branding now that companyName is
      // written — if another agent already established branding under
      // this exact agency name, this agent is automatically linked to
      // it with zero review (see autoEstablishBrandForUser). Exactly
      // like the billing-details call above: never blocks reaching the
      // dashboard, and can also complete later just by visiting the
      // dashboard or the branding page if it fails here.
      try {
        await authFetch('/api/branding/mine');
      } catch (brandingErr) {
        console.error('Signup branding auto-establish failed (non-blocking):', brandingErr);
      }

      // Redirect to dashboard
      router.push('/dashboard');
    } catch (err) {
      console.error('Signup error:', err);
      if (err.code === 'auth/email-already-in-use') {
        setError('An account with this email already exists');
      } else if (err.code === 'auth/invalid-email') {
        setError('Please enter a valid email address');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Join Premarket"
      subtitle="100% free. Start winning more listings today."
      footer={
        <p className="text-sm text-slate-500">
          Looking to buy a home?{' '}
          <Link href="/signup" className={AUTH_LINK_CLASS}>
            Create a buyer account &rarr;
          </Link>
        </p>
      }
    >
      <div className="flex rounded-xl bg-slate-100 p-1 mb-6">
        <button
          type="button"
          onClick={() => setSignupType('agent')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
            signupType === 'agent' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
          }`}
        >
          Individual Agent
        </button>
        <button
          type="button"
          onClick={() => setSignupType('office')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
            signupType === 'office' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
          }`}
        >
          Real Estate Office
        </button>
      </div>

      {signupType === 'office' ? (
        <form onSubmit={handleOfficeSubmit} className="space-y-5">
          <div>
            <label className={AUTH_LABEL_CLASS}>Office Name</label>
            <input
              type="text"
              required
              value={officeFormData.officeName}
              onChange={(e) => setOfficeFormData({ ...officeFormData, officeName: e.target.value })}
              className={AUTH_INPUT_CLASS}
              placeholder="e.g. Harcourts Property Hub"
            />
            <p className="text-xs text-slate-400 mt-1.5">
              Every agent who signs up later with this exact office name is automatically connected to it.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={AUTH_LABEL_CLASS}>Your First Name</label>
              <input
                type="text"
                required
                value={officeFormData.firstName}
                onChange={(e) => setOfficeFormData({ ...officeFormData, firstName: e.target.value })}
                className={AUTH_INPUT_CLASS}
                placeholder="John"
              />
            </div>
            <div>
              <label className={AUTH_LABEL_CLASS}>Your Last Name</label>
              <input
                type="text"
                required
                value={officeFormData.lastName}
                onChange={(e) => setOfficeFormData({ ...officeFormData, lastName: e.target.value })}
                className={AUTH_INPUT_CLASS}
                placeholder="Smith"
              />
            </div>
          </div>

          <p className="text-xs text-slate-500">You'll be registered as this office's initial administrator.</p>

          <div>
            <label className={AUTH_LABEL_CLASS}>Your Email Address</label>
            <input
              type="email"
              required
              value={officeFormData.email}
              onChange={(e) => setOfficeFormData({ ...officeFormData, email: e.target.value })}
              className={AUTH_INPUT_CLASS}
              placeholder="john@agency.com.au"
            />
          </div>

          <div>
            <label className={AUTH_LABEL_CLASS}>Your Phone Number</label>
            <div className="flex gap-2">
              <select
                value={officeFormData.countryCode}
                onChange={(e) => setOfficeFormData({ ...officeFormData, countryCode: e.target.value })}
                className="px-3 py-3 rounded-xl border border-slate-300 focus:border-[#e48900] focus:ring-2 focus:ring-orange-500/20 outline-none transition-all text-slate-900 text-[15px] bg-white"
              >
                {countryCodes.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.code}
                  </option>
                ))}
              </select>
              <input
                type="tel"
                required
                value={officeFormData.phone}
                onChange={handleOfficePhoneChange}
                className={`flex-1 ${AUTH_INPUT_CLASS}`}
                placeholder="412 345 678"
                maxLength={11}
              />
            </div>
          </div>

          <div>
            <label className={AUTH_LABEL_CLASS}>Password</label>
            <input
              type="password"
              required
              value={officeFormData.password}
              onChange={(e) => setOfficeFormData({ ...officeFormData, password: e.target.value })}
              className={AUTH_INPUT_CLASS}
              placeholder="Min 6 characters"
            />
          </div>

          <div>
            <label className={AUTH_LABEL_CLASS}>Confirm Password</label>
            <input
              type="password"
              required
              value={officeFormData.confirmPassword}
              onChange={(e) => setOfficeFormData({ ...officeFormData, confirmPassword: e.target.value })}
              className={AUTH_INPUT_CLASS}
              placeholder="Confirm your password"
            />
          </div>

          {officeError && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className={AUTH_ERROR_CLASS}>
              {officeError}
            </motion.div>
          )}

          <motion.button
            type="submit"
            disabled={officeLoading}
            whileHover={{ scale: officeLoading ? 1 : 1.01 }}
            whileTap={{ scale: officeLoading ? 1 : 0.99 }}
            className={AUTH_SUBMIT_CLASS}
          >
            {officeLoading ? 'Setting Up Your Office...' : 'Create Office Account'}
          </motion.button>

          <p className="text-center text-xs text-slate-500">
            By signing up, you agree to our{' '}
            <a href="/terms" className={AUTH_LINK_CLASS}>Terms &amp; Conditions</a>{' '}
            and{' '}
            <a href="/privacy" className={AUTH_LINK_CLASS}>Privacy Policy</a>
          </p>
        </form>
      ) : (
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={AUTH_LABEL_CLASS}>First Name</label>
            <input
              type="text"
              required
              value={formData.firstName}
              onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
              className={AUTH_INPUT_CLASS}
              placeholder="John"
            />
          </div>
          <div>
            <label className={AUTH_LABEL_CLASS}>Last Name</label>
            <input
              type="text"
              required
              value={formData.lastName}
              onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
              className={AUTH_INPUT_CLASS}
              placeholder="Smith"
            />
          </div>
        </div>

        <div>
          <label className={AUTH_LABEL_CLASS}>Email Address</label>
          <input
            type="email"
            required
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className={AUTH_INPUT_CLASS}
            placeholder="john@agency.com.au"
          />
        </div>

        <div>
          <label className={AUTH_LABEL_CLASS}>Phone Number</label>
          <div className="flex gap-2">
            <select
              value={formData.countryCode}
              onChange={(e) => setFormData({ ...formData, countryCode: e.target.value })}
              className="px-3 py-3 rounded-xl border border-slate-300 focus:border-[#e48900] focus:ring-2 focus:ring-orange-500/20 outline-none transition-all text-slate-900 text-[15px] bg-white"
            >
              {countryCodes.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.code}
                </option>
              ))}
            </select>
            <input
              type="tel"
              required
              value={formData.phone}
              onChange={handlePhoneChange}
              className={`flex-1 ${AUTH_INPUT_CLASS}`}
              placeholder="412 345 678"
              maxLength={11}
            />
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100">
          <h3 className="text-base font-semibold text-slate-900 mt-4 mb-1">Agency Billing Details</h3>
          <p className="text-sm text-slate-500 mb-4">
            Premarket invoices are issued to your agency. Please provide the email address of the person or accounts department responsible for payment.
          </p>

          <div className="space-y-4">
            <div>
              <label className={AUTH_LABEL_CLASS}>Agency Name</label>
              <input
                type="text"
                value={formData.agencyName}
                onChange={(e) => setFormData({ ...formData, agencyName: e.target.value })}
                className={AUTH_INPUT_CLASS}
                placeholder="e.g. Ray White, LJ Hooker (leave blank if you're independent)"
              />
            </div>
            <div>
              <label className={AUTH_LABEL_CLASS}>Accounts Contact Name</label>
              <input
                type="text"
                value={formData.billingContactName}
                onChange={(e) => setFormData({ ...formData, billingContactName: e.target.value })}
                className={AUTH_INPUT_CLASS}
                placeholder="Jane Smith"
              />
            </div>
            <div>
              <label className={AUTH_LABEL_CLASS}>Billing Email Address</label>
              <input
                type="email"
                required
                value={formData.billingEmail}
                onChange={(e) => setFormData({ ...formData, billingEmail: e.target.value })}
                className={AUTH_INPUT_CLASS}
                placeholder="accounts@agency.com.au"
              />
              <p className="text-xs text-slate-400 mt-1.5">This can be different from your login email.</p>
            </div>
          </div>
        </div>

        <div>
          <label className={AUTH_LABEL_CLASS}>Password</label>
          <input
            type="password"
            required
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            className={AUTH_INPUT_CLASS}
            placeholder="Min 6 characters"
          />
        </div>

        <div>
          <label className={AUTH_LABEL_CLASS}>Confirm Password</label>
          <input
            type="password"
            required
            value={formData.confirmPassword}
            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
            className={AUTH_INPUT_CLASS}
            placeholder="Confirm your password"
          />
        </div>

        {error && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className={AUTH_ERROR_CLASS}>
            {error}
          </motion.div>
        )}

        <motion.button
          type="submit"
          disabled={loading}
          whileHover={{ scale: loading ? 1 : 1.01 }}
          whileTap={{ scale: loading ? 1 : 0.99 }}
          className={AUTH_SUBMIT_CLASS}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Creating Account...
            </span>
          ) : (
            "Get Started"
          )}
        </motion.button>

        <p className="text-center text-xs text-slate-500">
          By signing up, you agree to our{' '}
          <a href="/terms" className={AUTH_LINK_CLASS}>Terms &amp; Conditions</a>{' '}
          and{' '}
          <a href="/privacy" className={AUTH_LINK_CLASS}>Privacy Policy</a>
        </p>
      </form>
      )}
    </AuthShell>
  );
}
