'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';

function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null); // 'success' | 'error' | null

  useEffect(() => {
    const emailParam = searchParams.get('email');
    if (emailParam) {
      setEmail(decodeURIComponent(emailParam));
    }
  }, [searchParams]);

  const handleUnsubscribe = async (e) => {
    e.preventDefault();

    if (!email || !email.includes('@')) {
      setStatus('error');
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      // Handled server-side: user documents are not readable from the browser.
      const res = await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!res.ok) throw new Error('Unsubscribe request failed');

      setStatus('success');
    } catch (error) {
      console.error('Error unsubscribing:', error);
      setStatus('error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center px-4 py-12">
      {/* Background decoration */}
      <div className="absolute inset-0 opacity-20 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-orange-500 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-md relative z-10"
      >
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {status === 'success' ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center"
            >
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-slate-900 mb-3">
                You've Been Unsubscribed
              </h1>
              <p className="text-slate-600 mb-6">
                You will no longer receive property alert emails from Premarket.
              </p>
              <p className="text-sm text-slate-500 mb-6">
                Changed your mind? You can update your preferences anytime in your account settings.
              </p>
              <a
                href="/"
                className="inline-block px-6 py-3 bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-bold rounded-xl hover:shadow-lg transition-all"
              >
                Return to Homepage
              </a>
            </motion.div>
          ) : status === 'error' ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center"
            >
              <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-slate-900 mb-3">
                Something Went Wrong
              </h1>
              <p className="text-slate-600 mb-6">
                We couldn't process your unsubscribe request. The email may not be registered in our system.
              </p>
              <div className="bg-slate-50 rounded-xl p-4 mb-6">
                <p className="text-sm text-slate-700 mb-2">
                  Need help? Contact us at:
                </p>
                <a
                  href="mailto:knockknock@premarket.homes"
                  className="text-orange-600 font-semibold hover:underline"
                >
                  knockknock@premarket.homes
                </a>
              </div>
              <button
                onClick={() => setStatus(null)}
                className="inline-block px-6 py-3 bg-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-300 transition-all"
              >
                Try Again
              </button>
            </motion.div>
          ) : (
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold text-slate-900 mb-2">
                  Unsubscribe from Emails
                </h1>
                <p className="text-slate-600">
                  We're sorry to see you go. Confirm your email below to unsubscribe from property alerts.
                </p>
              </div>

              <form onSubmit={handleUnsubscribe} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="your@email.com"
                    className="w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-4 bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-bold rounded-xl shadow-lg hover:shadow-orange-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Processing...
                    </span>
                  ) : (
                    'Unsubscribe'
                  )}
                </button>
              </form>

              <p className="text-xs text-center text-slate-500 mt-6">
                You'll still be able to access your account and browse properties. This only stops email notifications.
              </p>
            </>
          )}
        </div>

        {/* Footer link */}
        <p className="text-center text-slate-400 text-sm mt-6">
          <a href="/" className="hover:text-white transition-colors">
            ← Back to Premarket
          </a>
        </p>
      </motion.div>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-orange-500"></div>
      </div>
    }>
      <UnsubscribeContent />
    </Suspense>
  );
}
