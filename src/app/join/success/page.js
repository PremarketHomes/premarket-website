'use client';

import { useEffect, Suspense } from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';

function SuccessContent() {
  useEffect(() => {
    // Clear session storage on success
    sessionStorage.removeItem('agentSignupUid');
  }, []);

  return (
    <>
      {/* Success Icon */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', duration: 0.6 }}
        className="w-24 h-24 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center mx-auto mb-8 shadow-lg shadow-green-500/30"
      >
        <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      </motion.div>

      <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
        Welcome to Premarket
      </h1>
      <p className="text-xl text-slate-600 mb-8">
        Your free account is ready to go
      </p>

      {/* Info Card */}
      <div className="bg-gradient-to-br from-slate-50 to-orange-50/30 rounded-2xl p-6 mb-8 border border-slate-200">
        <h3 className="font-bold text-slate-900 mb-3">You&apos;re all set!</h3>
        <p className="text-slate-600 mb-4">
          Log in to your dashboard to start creating pre-market campaigns and winning more listings.
        </p>
        <ul className="space-y-2 text-sm text-slate-600">
          <li className="flex items-center gap-2">
            <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Unlimited pre-market campaigns
          </li>
          <li className="flex items-center gap-2">
            <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Real buyer price opinions
          </li>
          <li className="flex items-center gap-2">
            <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Qualified buyer lead capture
          </li>
          <li className="flex items-center gap-2">
            <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Full access — always free
          </li>
        </ul>
      </div>

      {/* Next step */}
      <Link
        href="/dashboard"
        className="block w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-4 rounded-xl shadow-lg mb-8 transition-colors"
      >
        Go to your dashboard
      </Link>

      {/* Help */}
      <p className="text-sm text-slate-500">
        Need help getting started?{' '}
        <a href="mailto:knockknock@premarket.homes" className="text-orange-600 hover:underline">
          Contact Support
        </a>
      </p>
    </>
  );
}

export default function AgentSuccess() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white flex items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-lg text-center"
      >
        {/* Logo */}
        <Image
          src="https://premarketvideos.b-cdn.net/assets/logo.png"
          alt="Premarket"
          width={150}
          height={38}
          className="mx-auto mb-8"
          unoptimized
        />

        <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
          <Suspense fallback={
            <div className="flex items-center justify-center py-12">
              <svg className="animate-spin w-8 h-8 text-orange-500" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          }>
            <SuccessContent />
          </Suspense>
        </div>
      </motion.div>
    </div>
  );
}
