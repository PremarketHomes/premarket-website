'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Nav from '../components/Nav';

export default function Hero() {
  const sectionRef = useRef(null);
  const [gradientPos, setGradientPos] = useState('50%');
  const [videoOpen, setVideoOpen] = useState(false);

  return (
    <section
      ref={sectionRef}
      className="relative bg-white overflow-hidden"
    >
      <Nav />

      {/* Hero Content */}
      <div className="relative bg-cover bg-center bg-no-repeat min-h-[600px] sm:min-h-[700px] lg:min-h-0" 
           style={{ 
             backgroundImage: "url('https://premarketvideos.b-cdn.net/assets/man.jpeg')", 
             backgroundPosition: 'center 20%' 
           }}>
        {/* Dark overlay for better text readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/30 to-black/40 sm:bg-none" />
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Main Content Grid */}
          <div className="grid lg:grid-cols-4 gap-8 lg:gap-16 items-center mb-12 lg:mb-20">
            {/* Left Column - Text Content */}
            <div className="col-span-3 text-center lg:text-left py-8 sm:py-12 lg:py-28">
              {/* Badge */}
              <div className="flex justify-center lg:justify-start mb-4 sm:mb-6">
                <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 bg-gradient-to-r from-amber-50 to-orange-50 rounded-full border border-amber-200 shadow-lg">
                  <span className="text-xs sm:text-sm font-bold text-amber-700">
                    <span>The #1 app home owners and buyers wish they had</span>
                  </span>
                </div>
              </div>

              {/* Main Heading */}
              <h1 className="text-7xl sm:text-5xl lg:text-[90px] leading-none lg:leading-none interBold text-white mb-3 sm:mb-4 lg:mb-6 drop-shadow-2xl">
                Test the Market Before Selling Your Property
              </h1>

              <h2 className="text-xl sm:text-2xl lg:text-2xl leading-snug interMedium text-white mb-4 sm:mb-6 drop-shadow-lg">
                Free Off-Market Property Listings for Australian Homeowners
              </h2>

              {/* Subheading with Gradient */}
              <div className="mb-6 sm:mb-8 max-w-full lg:w-2/3">
                <p
                  className="text-base sm:text-lg lg:text-xl font-medium leading-relaxed text-white drop-shadow-lg"

                >
                  Get genuine price opinions from real buyers before committing to an agent. Run a free premarket campaign on your Australian property, receive buyer feedback fast, and make informed decisions. No open homes, no agent fees, no risk.
                </p>
              </div>

            </div>

            {/* Right Column - Video Thumbnail */}
            <div className="relative lg:order-last order-first h-full hidden lg:block">
              <div className="relative h-full">
                {/* Video Thumbnail with Play Button */}
                <div 
                  onClick={() => setVideoOpen(true)}
                  className="relative w-full mx-auto overflow-hidden h-full cursor-pointer group"
                >
                  {/* Play Button */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform">
                      <svg className="w-10 h-10 text-[#e48900] ml-1" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                      </svg>
                    </div>
                  </div>

                  {/* Duration Badge */}
                  <div className="absolute bottom-4 right-4 bg-black/70 text-white px-3 py-1 rounded-full text-sm font-semibold">
                    2:30
                  </div>
                </div>

                {/* Decorative Elements */}
                <div className="absolute -bottom-6 -right-6 w-64 h-64 bg-orange-200 rounded-full blur-3xl opacity-20 -z-10" />
                <div className="absolute -top-6 -left-6 w-64 h-64 bg-amber-200 rounded-full blur-3xl opacity-20 -z-10" />
              </div>
            </div>
          </div>

          {/* Mobile Video Button - Shows only on mobile */}
          <div className="lg:hidden flex justify-center pb-8">
            <button
              onClick={() => setVideoOpen(true)}
              className="group flex items-center gap-3 px-6 py-4 bg-white/95 hover:bg-white rounded-full shadow-xl transition-all active:scale-95"
            >
              <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-amber-500 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                </svg>
              </div>
              <div className="text-left">
                <div className="text-sm font-bold text-gray-900">Watch Demo</div>
                <div className="text-xs text-gray-600">2:30 min</div>
              </div>
            </button>
          </div>
        </div>

        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute top-40 right-0 w-96 h-96 bg-orange-100 rounded-full blur-3xl opacity-10" />
          <div className="absolute bottom-40 left-0 w-96 h-96 bg-amber-100 rounded-full blur-3xl opacity-10" />
        </div>
      </div>

      {/* How It Works Section */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 lg:py-20">
        <div className="text-center mb-8 sm:mb-12">
          <h2 className="text-2xl sm:text-3xl lg:text-5xl interBold text-gray-900 mb-3 sm:mb-4">
            How Premarket Works for Australian Homeowners
          </h2>
          <p className="text-base sm:text-lg text-gray-600 max-w-2xl mx-auto px-4">
            Three simple steps to test the market and get real buyer feedback before selling your property
          </p>
        </div>

        {/* Feature Cards */}
        <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
            {/* Step 1 */}
            <div className="p-6 sm:p-8 lg:p-10 text-center group hover:bg-gradient-to-br hover:from-orange-50 hover:to-amber-50 transition-all duration-300">
              <div className="flex justify-center mb-4 sm:mb-6">
                <div className="w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-orange-100 to-amber-100 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-lg">
                  <svg className="w-7 h-7 sm:w-8 sm:h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                </div>
              </div>
              <div className="inline-block px-3 py-1 bg-orange-100 text-orange-600 rounded-full text-xs font-bold mb-3 sm:mb-4">
                STEP 1
              </div>
              <h3 className="text-xl sm:text-2xl interBold text-gray-900 mb-3 sm:mb-4">
                List Your Property Free on Premarket
              </h3>
              <p className="text-sm sm:text-base text-gray-600 leading-relaxed">
                Australian homeowners can create a free pre-market listing in minutes and test what buyers think your property is worth—no agent required.
              </p>
            </div>

            {/* Step 2 */}
            <div className="p-6 sm:p-8 lg:p-10 text-center group hover:bg-gradient-to-br hover:from-orange-50 hover:to-amber-50 transition-all duration-300">
              <div className="flex justify-center mb-4 sm:mb-6">
                <div className="w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-orange-100 to-amber-100 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-lg">
                  <svg className="w-7 h-7 sm:w-8 sm:h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <div className="inline-block px-3 py-1 bg-orange-100 text-orange-600 rounded-full text-xs font-bold mb-3 sm:mb-4">
                STEP 2
              </div>
              <h3 className="text-xl sm:text-2xl interBold text-gray-900 mb-3 sm:mb-4">
                Buyers Give Price Opinions
              </h3>
              <p className="text-sm sm:text-base text-gray-600 leading-relaxed">
                Buyers and investors share their price opinions and express genuine interest in the property.
              </p>
            </div>

            {/* Step 3 */}
            <div className="p-6 sm:p-8 lg:p-10 text-center group hover:bg-gradient-to-br hover:from-orange-50 hover:to-amber-50 transition-all duration-300">
              <div className="flex justify-center mb-4 sm:mb-6">
                <div className="w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-orange-100 to-amber-100 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-lg">
                  <svg className="w-7 h-7 sm:w-8 sm:h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              </div>
              <div className="inline-block px-3 py-1 bg-orange-100 text-orange-600 rounded-full text-xs font-bold mb-3 sm:mb-4">
                STEP 3
              </div>
              <h3 className="text-xl sm:text-2xl interBold text-gray-900 mb-3 sm:mb-4">
                Receive Your Free Report
              </h3>
              <p className="text-sm sm:text-base text-gray-600 leading-relaxed">
                Get a comprehensive market report giving you confidence to go to market or stay put.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Video Lightbox Modal */}
      {videoOpen && (
        <div 
          className="fixed inset-0 bg-black/95 z-[100] flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setVideoOpen(false); }}
        >
          {/* Close Button */}
          <button
            onClick={() => setVideoOpen(false)}
            className="absolute top-4 right-4 z-10 w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors"
          >
            <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Video Container */}
          <div 
            className="relative max-w-5xl w-full aspect-video"
            onClick={(e) => e.stopPropagation()}
          >
            <video
              src="https://premarketvideos.b-cdn.net/assets/forVendors.mp4"
              className="w-full h-full rounded-lg sm:rounded-2xl shadow-2xl"
              controls
              autoPlay
              playsInline
            />
          </div>
        </div>
      )}
    </section>
  );
}