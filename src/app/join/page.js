'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { auth, db } from '../firebase/clientApp';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AuthShell from '../components/public-site/AuthShell';
import {
  AUTH_LABEL_CLASS,
  AUTH_INPUT_CLASS,
  AUTH_SUBMIT_CLASS,
  AUTH_ERROR_CLASS,
  AUTH_LINK_CLASS,
} from '../components/public-site/authFieldStyles';

export default function AgentSignup() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
    countryCode: '+61',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    </AuthShell>
  );
}
