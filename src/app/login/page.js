'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase/clientApp';
import { useAuth } from '../context/AuthContext';
import { defaultDashboardFor } from '../utils/roles';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import AuthShell from '../components/public-site/AuthShell';
import {
  AUTH_LABEL_CLASS,
  AUTH_INPUT_CLASS,
  AUTH_SUBMIT_CLASS,
  AUTH_ERROR_CLASS,
  AUTH_LINK_CLASS,
} from '../components/public-site/authFieldStyles';

export default function LoginPage() {
  const router = useRouter();
  const { user, userData, loading: authLoading } = useAuth();
  const [view, setView] = useState('login'); // 'login' | 'reset'

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Reset state
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSent, setResetSent] = useState(false);

  // If already logged in, redirect to the right dashboard for their role.
  // Wait for userData so buyers don't briefly land on /dashboard.
  useEffect(() => {
    if (!authLoading && user && userData) {
      router.push(defaultDashboardFor(userData));
    }
  }, [user, userData, authLoading, router]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Don't push here — the useEffect above waits for userData
      // and routes buyers to /buyer-dashboard, agents to /dashboard.
    } catch (err) {
      console.error('Login error:', err);
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Invalid email or password');
      } else if (err.code === 'auth/invalid-email') {
        setError('Please enter a valid email address');
      } else if (err.code === 'auth/too-many-requests') {
        setError('Too many attempts. Please try again later.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setResetError('');
    setResetLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail }),
      });
      if (!res.ok) throw new Error('Request failed');
      setResetSent(true);
    } catch (err) {
      console.error('Reset error:', err);
      setResetError('Something went wrong. Please try again.');
    } finally {
      setResetLoading(false);
    }
  };

  const switchToReset = () => {
    setView('reset');
    setResetEmail(email);
    setResetError('');
    setResetSent(false);
  };

  const switchToLogin = () => {
    setView('login');
    setError('');
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-[#e48900]" />
      </div>
    );
  }

  if (user) return null;

  return (
    <AuthShell
      title={view === 'login' ? 'Welcome back' : 'Reset password'}
      subtitle={
        view === 'login'
          ? 'Sign in to your Premarket account'
          : resetSent
          ? 'Check your email for a reset link'
          : 'Enter your email to receive a reset link'
      }
      footer={
        view === 'login' ? (
          <>
            <p className="text-sm text-slate-500">
              Real estate agent?{' '}
              <Link href="/join" className={AUTH_LINK_CLASS}>
                Get started
              </Link>
            </p>
            <p className="text-xs text-slate-400">
              Buyer?{' '}
              <Link href="/signup" className={AUTH_LINK_CLASS}>
                Create a buyer account
              </Link>
            </p>
          </>
        ) : null
      }
    >
      <AnimatePresence mode="wait">
        {view === 'login' ? (
          <motion.div
            key="login"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3 }}
          >
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className={AUTH_LABEL_CLASS}>Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={AUTH_INPUT_CLASS}
                  placeholder="john@agency.com.au"
                  autoComplete="email"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={AUTH_LABEL_CLASS.replace(' mb-2', '')}>Password</label>
                  <button
                    type="button"
                    onClick={switchToReset}
                    className="text-sm text-[#e48900] hover:text-[#c64500] font-medium"
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={AUTH_INPUT_CLASS}
                  placeholder="Your password"
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={AUTH_ERROR_CLASS}
                >
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
                    Signing In...
                  </span>
                ) : (
                  'Sign In'
                )}
              </motion.button>
            </form>
          </motion.div>
        ) : (
          <motion.div
            key="reset"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3 }}
          >
            {resetSent ? (
              <div className="text-center py-2">
                <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-slate-900 font-semibold mb-2">Email sent</p>
                <p className="text-slate-500 text-sm mb-6">
                  We&apos;ve sent a password reset link to <strong className="text-slate-700">{resetEmail}</strong>. Check your inbox and follow the instructions.
                </p>
                <button onClick={switchToLogin} className={AUTH_SUBMIT_CLASS}>
                  Back to Sign In
                </button>
              </div>
            ) : (
              <form onSubmit={handleReset} className="space-y-5">
                <div>
                  <label className={AUTH_LABEL_CLASS}>Email Address</label>
                  <input
                    type="email"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    className={AUTH_INPUT_CLASS}
                    placeholder="john@agency.com.au"
                    autoComplete="email"
                    autoFocus
                  />
                </div>

                {resetError && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={AUTH_ERROR_CLASS}
                  >
                    {resetError}
                  </motion.div>
                )}

                <motion.button
                  type="submit"
                  disabled={resetLoading}
                  whileHover={{ scale: resetLoading ? 1 : 1.01 }}
                  whileTap={{ scale: resetLoading ? 1 : 0.99 }}
                  className={AUTH_SUBMIT_CLASS}
                >
                  {resetLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Sending...
                    </span>
                  ) : (
                    'Send Reset Link'
                  )}
                </motion.button>
              </form>
            )}

            {!resetSent && (
              <div className="mt-6">
                <button
                  onClick={switchToLogin}
                  className="flex items-center justify-center gap-2 w-full text-sm text-slate-500 hover:text-slate-700 font-medium transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to Sign In
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </AuthShell>
  );
}
