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
      <div className="relative bg-white bg-cover bg-left" style={{ backgroundImage: "url('https://premarketvideos.b-cdn.net/assets/busstop.png')" }}>
        
        <div 
        className="absolute inset-0 z-[1]"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(0, 0, 0, 0.4) 1px, transparent 1px)',
          backgroundSize: '2px 2px'
        }}
      />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-50" >
          
          {/* Main Content Grid */}
          <div className="grid lg:grid-cols-4 gap-4 lg:gap-16 items-center mb-20">
            {/* Left Column - Text Content */}
            <div className="col-span-3 text-center lg:text-left py-12 sm:py-20 lg:py-28">
              {/* Badge */}
              <div className="flex justify-center lg:justify-start mb-6">
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-50 to-orange-50 rounded-full border border-amber-200">
          
                  <span className="text-xs sm:text-sm font-bold text-amber-700">
                    <span>You're smarter than that</span>
                  </span>
                </div>
              </div>

              {/* Main Heading */}
              <h1 className="text-6xl sm:text-4xl text-shadow-lg leading-none lg:text-[140px] tracking-tight interBold text-white mb-6">
                Win More Real Estate Listings in Australia
              </h1>

               <h2 className="text-4xl sm:text-3xl leading-none lg:text-2xl interMedium text-white mb-6">
                Generate Exclusive Seller Leads with Free Premarket Campaigns

              </h2>

              {/* Subheading with Gradient */}
              <div className="mb-8 w-full sm:w-2/3">
                <p
                  className="text-lg sm:text-xl lg:text-xl font-medium leading-relaxed bg-clip-text text-transparent"
                  style={{
                    backgroundImage: `linear-gradient(to right, #fff, #fff)`,
                    backgroundSize: `200%`,
                    backgroundPositionX: gradientPos,
                  }}
                >
                  Australian real estate agents using Premarket win 10x more listings by offering free premarket campaigns to vendors. Build trust, demonstrate value, and generate qualified seller leads before your competition.
                </p>
              </div>

              {/* Trust Indicators */}
              {/* <div className="flex flex-wrap justify-center lg:justify-start items-center gap-6 text-sm text-gray-600">
                
                <img src="https://www.pikpng.com/pngl/b/328-3285377_how-to-apply-trustpilot-5-star-logo-clipart.png" className='w-40' />
                </div> */}
            </div>

            {/* Right Column - Video Thumbnail */}
            <div className="relative lg:order-last order-first h-full">
              <div className="relative h-full">
                {/* Video Thumbnail with Play Button */}
                <div 
                  onClick={() => setVideoOpen(true)}
                  className="relative w-full mx-auto overflow-hidden h-full cursor-pointer"
                >
                 
                  
                 

          \
                </div>

                {/* Decorative Elements */}
                <div className="absolute -bottom-6 -right-6 w-64 h-64 bg-orange-200 rounded-full blur-3xl opacity-20 -z-10" />
                <div className="absolute -top-6 -left-6 w-64 h-64 bg-amber-200 rounded-full blur-3xl opacity-20 -z-10" />
              </div>
            </div>
          </div>

    
        </div>

        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute top-40 right-0 w-96 h-96 bg-orange-100 rounded-full blur-3xl opacity-10" />
          <div className="absolute bottom-40 left-0 w-96 h-96 bg-amber-100 rounded-full blur-3xl opacity-10" />
        </div>
      </div>

            {/* How It Works Section */}
          <div className="max-w-6xl mx-auto p-6">
<div className="relative">

  {/* Play Button */}
  <div className='text-center mb-4'>
    <span className='text-center text-2xl text-purple-800 text-sm bg-purple-100 rounded-full p-2'>See what agents are saying about Premarket</span>
  </div>
                  <div  onClick={() => setVideoOpen(true)} className="z-50 cursor-pointer absolute inset-0 flex items-center justify-center">
                    <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-2xl">
                      <svg className="w-10 h-10 text-[#e48900] ml-1" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                      </svg>
                    </div>
                  </div>

                <img src={'https://premarketvideos.b-cdn.net/assets/busstop.png'} alt="How It Works" className="mx-auto w-full sm:w-1/2 mb-12 rounded-xl shadow-2xl" />
</div>
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl lg:text-5xl interBold text-gray-900 mb-4">
                How It Works For Agents
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Three simple steps to help build trust, demonstrate value, and win more listings.
                </p>
            </div>

            {/* Feature Cards */}
            <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden mb-20">
              <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
                {/* Step 1 */}
                <div className="p-8 lg:p-10 text-center group hover:bg-gradient-to-br hover:from-orange-50 hover:to-amber-50 transition-all duration-300">
                  <div className="flex justify-center mb-6">
                    <div className="w-16 h-16 bg-gradient-to-br from-orange-100 to-amber-100 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-lg">
                      <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                    </div>
                  </div>
                  <div className="inline-block px-3 py-1 bg-orange-100 text-orange-600 rounded-full text-xs font-bold mb-4">
                    STEP 1
                  </div>
                  <h3 className="text-2xl interBold text-gray-900 mb-4">
                    Offer your prospects a free Premarket campaign
                  </h3>
                  <p className="text-gray-600 leading-relaxed">
                    Agents offering Premarket are 10X more likely to win the listing by providing real value upfront.
                  </p>
                </div>

                {/* Step 2 */}
                <div className="p-8 lg:p-10 text-center group hover:bg-gradient-to-br hover:from-orange-50 hover:to-amber-50 transition-all duration-300">
                  <div className="flex justify-center mb-6">
                    <div className="w-16 h-16 bg-gradient-to-br from-orange-100 to-amber-100 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-lg">
                      <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                  <div className="inline-block px-3 py-1 bg-orange-100 text-orange-600 rounded-full text-xs font-bold mb-4">
                    STEP 2
                  </div>
                  <h3 className="text-2xl interBold text-gray-900 mb-4">
                    Buyers Give Price Opinions
                  </h3>
                  <p className="text-gray-600 leading-relaxed">
                    Buyers and investors share their price opinions and express genuine interest in the property.
                  </p>
                </div>

                {/* Step 3 */}
                <div className="p-8 lg:p-10 text-center group hover:bg-gradient-to-br hover:from-orange-50 hover:to-amber-50 transition-all duration-300">
                  <div className="flex justify-center mb-6">
                    <div className="w-16 h-16 bg-gradient-to-br from-orange-100 to-amber-100 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-lg">
                      <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                  </div>
                  <div className="inline-block px-3 py-1 bg-orange-100 text-orange-600 rounded-full text-xs font-bold mb-4">
                    STEP 3
                  </div>
                  <h3 className="text-2xl interBold text-gray-900 mb-4">
                    Present Your Report
                  </h3>
                  <p className="text-gray-600 leading-relaxed">
                    Give your prospects the confidence they need. Complete with buyer details and average price opinions.
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
            className="absolute top-4 right-4 z-10 w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors"
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              className="w-full h-full rounded-2xl shadow-2xl"
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