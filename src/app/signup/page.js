'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { auth, db } from '../firebase/clientApp';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthShell from '../components/public-site/AuthShell';
import {
  AUTH_LABEL_CLASS,
  AUTH_INPUT_CLASS,
  AUTH_SUBMIT_CLASS,
  AUTH_ERROR_CLASS,
  AUTH_LINK_CLASS,
} from '../components/public-site/authFieldStyles';

function BuyerSignupInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo') || '';

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

    setLoading(true);

    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        formData.email,
        formData.password
      );
      const user = userCredential.user;

      await setDoc(doc(db, 'users', user.uid), {
        avatar:
          'https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png?20150327203541',
        created: Timestamp.now(),
        email: formData.email.toLowerCase(),
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        agent: false,
        pro: false,
        isBuyer: true,
        roles: ['buyer'],
        active: true,
        // Legacy sub-object kept so the Flutter app continues to work.
        buyerMetrics: { budget: 0, cashBuyer: false, investor: false },
        buyerProfile: { onboardingComplete: false },
        updatedAt: Timestamp.now(),
      });

      const next =
        '/buyer-dashboard/welcome' +
        (returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '');
      router.push(next);
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
      title="Create your buyer account"
      subtitle="Optional — keep track of properties you've been sent and the opinions you've shared."
      footer={
        <>
          <p className="text-sm text-slate-500">
            Already have an account?{' '}
            <Link href="/login" className={AUTH_LINK_CLASS}>
              Log in
            </Link>
          </p>
          <p className="text-sm text-slate-400">
            Looking to list a property?{' '}
            <Link href="/join" className={AUTH_LINK_CLASS}>
              Agents join here &rarr;
            </Link>
          </p>
        </>
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
              placeholder="Jane"
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
              placeholder="Doe"
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
            placeholder="jane@example.com"
          />
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
            'Create free account'
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

export default function BuyerSignup() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <BuyerSignupInner />
    </Suspense>
  );
}
