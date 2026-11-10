'use client';

import { motion, AnimatePresence, useScroll, useTransform, useInView } from 'framer-motion';
import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';

// ══════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════


const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (delay = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, delay, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
};

const stagger = {
  visible: { transition: { staggerChildren: 0.12 } },
};

// ══════════════════════════════════════════════
// SECTION 1: HERO (ATTENTION)
// ══════════════════════════════════════════════

function HeroSection() {
  const [sellerPrice, setSellerPrice] = useState(0);
  const [buyerPrice, setBuyerPrice] = useState(0);
  const [showGap, setShowGap] = useState(false);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  useEffect(() => {
    if (!isInView) return;
    const start = performance.now();

    const animate = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / 2000, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      setSellerPrice(Math.round(eased * 1500000));
      setBuyerPrice(Math.round(eased * 1280000));

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setTimeout(() => setShowGap(true), 400);
      }
    };
    setTimeout(() => requestAnimationFrame(animate), 800);
  }, [isInView]);

  return (
    <section ref={ref} className="relative min-h-screen flex items-center justify-center overflow-hidden bg-slate-950">
      {/* Animated grid background */}
      <div className="absolute inset-0 opacity-[0.04]" style={{
        backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
        backgroundSize: '60px 60px',
      }} />

      {/* Animated gradient orbs */}
      <motion.div
        animate={{ x: [0, 30, 0], y: [0, -20, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-orange-500/10 rounded-full blur-[120px]"
      />
      <motion.div
        animate={{ x: [0, -30, 0], y: [0, 20, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] bg-blue-500/8 rounded-full blur-[120px]"
      />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 relative z-10 text-center">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="inline-flex items-center gap-2 px-4 py-1.5 bg-white/5 border border-white/10 rounded-full mb-8"
        >
          <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
          <span className="text-sm text-slate-400 font-medium">The #1 reason listings fail</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="text-4xl sm:text-5xl lg:text-7xl font-bold text-white leading-[1.05] mb-8 tracking-tight"
        >
          Every Overpriced Listing{' '}
          <br className="hidden sm:block" />
          Started With{' '}
          <span className="bg-gradient-to-r from-orange-400 to-red-400 bg-clip-text text-transparent">
            The Same Conversation.
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.5 }}
          className="text-lg sm:text-xl text-slate-400 max-w-3xl mx-auto mb-12 leading-relaxed"
        >
          Your seller expects more than buyers will pay.
          You know it. They don&apos;t believe it.
          And right now, you don&apos;t have the evidence to prove it.
        </motion.p>

        {/* Animated Price Gap Visual */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.7 }}
          className="max-w-2xl mx-auto mb-12"
        >
          <div className="bg-white/[0.03] backdrop-blur-sm border border-white/10 rounded-2xl p-6 sm:p-8">
            <div className="grid grid-cols-2 gap-6 sm:gap-8">
              <div className="text-center">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Seller expects</p>
                <p className="text-2xl sm:text-4xl font-bold text-white tabular-nums">
                  ${sellerPrice.toLocaleString()}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Buyers would pay</p>
                <p className="text-2xl sm:text-4xl font-bold text-orange-400 tabular-nums">
                  ${buyerPrice.toLocaleString()}
                </p>
              </div>
            </div>

            <AnimatePresence>
              {showGap && (
                <motion.div
                  initial={{ opacity: 0, scaleX: 0 }}
                  animate={{ opacity: 1, scaleX: 1 }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  className="mt-6 pt-6 border-t border-white/10 text-center origin-center"
                >
                  <p className="text-xs font-semibold text-red-400/80 uppercase tracking-wider mb-1">The Gap</p>
                  <motion.p
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 10 }}
                    className="text-3xl sm:text-4xl font-bold text-red-400"
                  >
                    -$220,000
                  </motion.p>
                  <p className="text-sm text-slate-500 mt-2">This gap costs agents listings every single day.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.2 }}
          className="flex flex-col sm:flex-row gap-4 justify-center"
        >
          <motion.a
            href="/join"
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-slate-900 bg-gradient-to-r from-orange-400 to-orange-500 rounded-xl shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40 transition-shadow duration-300"
          >
            Start Collecting Buyer Data
            <svg className="ml-2 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </motion.a>
          <motion.a
            href="https://calendly.com/knockknock-premarket/30min"
            target="_blank"
            rel="noopener noreferrer"
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-white border border-white/20 rounded-xl hover:bg-white/5 transition-colors duration-300"
          >
            Book a Demo
          </motion.a>
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="w-6 h-10 rounded-full border-2 border-white/20 flex items-start justify-center p-2"
        >
          <div className="w-1 h-2 bg-white/40 rounded-full" />
        </motion.div>
      </motion.div>
    </section>
  );
}


// ══════════════════════════════════════════════
// SECTION 3: THE PROBLEM (INTEREST)
// ══════════════════════════════════════════════

function TheProblem() {
  return (
    <section className="py-24 lg:py-36 bg-white relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.02]" style={{
        backgroundImage: `radial-gradient(circle at 1px 1px, rgb(0 0 0) 1px, transparent 0)`,
        backgroundSize: '32px 32px',
      }} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Header */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="text-center mb-20"
        >
          <motion.h2
            variants={fadeUp}
            custom={0}
            className="text-3xl sm:text-4xl lg:text-6xl font-bold text-slate-900 leading-tight mb-6"
          >
            You Either Tell The Truth{' '}
            <br className="hidden lg:block" />
            <span className="bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent">
              And Lose The Listing.
            </span>
          </motion.h2>
          <motion.p
            variants={fadeUp}
            custom={0.15}
            className="text-xl text-slate-500 max-w-3xl mx-auto leading-relaxed"
          >
            Or agree to an unrealistic price and watch the campaign fail.
            Both paths end the same way.
          </motion.p>
        </motion.div>

        {/* Two paths */}
        <div className="grid md:grid-cols-2 gap-6 lg:gap-8 mb-20">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="relative group"
          >
            <div className="bg-slate-50 rounded-2xl p-8 border border-slate-200 hover:border-slate-300 transition-colors h-full">
              <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center mb-5">
                <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">PATH A: Tell the truth</h3>
              <p className="text-slate-600 leading-relaxed mb-4">
                You recommend $1.28M. They wanted $1.5M. They thank you for your time and list with the agent who promised more.
              </p>
              <div className="bg-red-50 rounded-lg p-4 border border-red-100">
                <p className="text-sm text-red-700 font-medium">
                  Six months later, it sells for $1.25M. With the other agent.
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="relative group"
          >
            <div className="bg-slate-50 rounded-2xl p-8 border border-slate-200 hover:border-slate-300 transition-colors h-full">
              <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center mb-5">
                <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">PATH B: Agree to their price</h3>
              <p className="text-slate-600 leading-relaxed mb-4">
                You list at $1.5M. It sits for 10 weeks. Price drops. Drops again. The vendor blames you. Trust erodes.
              </p>
              <div className="bg-amber-50 rounded-lg p-4 border border-amber-100">
                <p className="text-sm text-amber-700 font-medium">
                  The listing dies on the portals. You both lose.
                </p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Dust not data */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="max-w-4xl mx-auto mb-20"
        >
          <div className="bg-slate-900 rounded-2xl p-8 lg:p-12 relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-orange-500/10 via-transparent to-transparent" />
            <div className="relative z-10">
              <p className="text-2xl lg:text-3xl font-bold text-white leading-snug mb-4">
                Static photos in office windows collect <span className="text-slate-500 line-through">dust</span>.
                <br />
                Not <span className="bg-gradient-to-r from-orange-400 to-orange-300 bg-clip-text text-transparent">data</span>.
              </p>
              <p className="text-lg text-slate-400 leading-relaxed">
                Every buyer who looks at a listing and walks away takes their insight with them.
                What would they have paid? Were they close? Were they serious?
                You&apos;ll never know. That intelligence is gone.
              </p>
            </div>
          </div>
        </motion.div>

        {/* The Bridge */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="text-center"
        >
          <p className="text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-900 leading-snug">
            What if you didn&apos;t have to guess?
            <br />
            <span className="bg-gradient-to-r from-orange-500 to-orange-600 bg-clip-text text-transparent">
              What if buyers told you?
            </span>
          </p>
        </motion.div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════
// SECTION 4: PRICE EDUCATION REVEAL (DESIRE)
// ══════════════════════════════════════════════

function PriceEducationReveal() {
  return (
    <section className="py-24 lg:py-36 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 relative overflow-hidden">
      {/* Animated background */}
      <motion.div
        animate={{ rotate: [0, 360] }}
        transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] opacity-[0.03]"
        style={{
          background: 'conic-gradient(from 0deg, transparent, rgba(251,146,60,0.3), transparent, rgba(251,146,60,0.1), transparent)',
        }}
      />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <motion.p
            initial={{ opacity: 0, letterSpacing: '0.5em' }}
            whileInView={{ opacity: 1, letterSpacing: '0.3em' }}
            viewport={{ once: true }}
            transition={{ duration: 1, delay: 0.2 }}
            className="text-sm font-bold text-orange-400 uppercase tracking-[0.3em] mb-6"
          >
            The Solution
          </motion.p>

          <h2 className="text-4xl sm:text-5xl lg:text-7xl font-bold text-white leading-[1.05] mb-8 tracking-tight">
            Price Education
            <br />
            <span className="bg-gradient-to-r from-orange-400 via-orange-300 to-amber-400 bg-clip-text text-transparent">
              Backed by Data.
            </span>
          </h2>

          <p className="text-xl sm:text-2xl text-slate-400 max-w-3xl mx-auto leading-relaxed mb-8">
            A home is worth what a buyer would pay for it.
            <br className="hidden sm:block" />
            <span className="text-white font-semibold">
              Not what the house across the street sold for two months ago.
            </span>
          </p>

          <p className="text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed">
            Premarket captures what no other platform can: direct price opinions from real buyers.
            Not modelled. Not inferred. <span className="text-slate-300">Measured.</span>
          </p>
        </motion.div>

        {/* Three pillars */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
          className="grid md:grid-cols-3 gap-6 lg:gap-8"
        >
          {[
            {
              icon: (
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              ),
              title: 'Buyers set the price',
              desc: 'Real people submit what they\'d genuinely pay. Not algorithms. Not comparables. Direct buyer valuations that update in real time.',
            },
            {
              icon: (
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              ),
              title: 'Data replaces opinion',
              desc: 'Walk into the vendor conversation with a median buyer price, opinion distribution, and demand signals. The evidence speaks for itself.',
            },
            {
              icon: (
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              ),
              title: 'Confidence, not conflict',
              desc: 'The seller hears it from buyers — not from you. The awkward conversation disappears. Expectations align with reality because the proof is undeniable.',
            },
          ].map((item, i) => (
            <motion.div
              key={i}
              variants={fadeUp}
              custom={i * 0.1}
              className="bg-white/[0.04] backdrop-blur-sm border border-white/10 rounded-2xl p-8 hover:bg-white/[0.06] hover:border-white/15 transition-all duration-300"
            >
              <div className="w-14 h-14 bg-gradient-to-br from-orange-500/20 to-orange-600/10 border border-orange-500/20 rounded-xl flex items-center justify-center text-orange-400 mb-5">
                {item.icon}
              </div>
              <h3 className="text-xl font-bold text-white mb-3">{item.title}</h3>
              <p className="text-slate-400 leading-relaxed">{item.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════
// SECTION 5: ANIMATED DEMO (DESIRE)
// ══════════════════════════════════════════════

function AnimatedCursor({ x, y, clicking }) {
  return (
    <motion.div
      className="absolute z-50 pointer-events-none"
      animate={{ x, y }}
      transition={{ duration: 0.8, ease: 'easeInOut' }}
    >
      <motion.svg width="24" height="24" viewBox="0 0 24 24" fill="none"
        animate={{ scale: clicking ? 0.8 : 1 }}
        transition={{ duration: 0.1 }}
      >
        <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.48 0 .72-.58.38-.92L6.35 2.85a.5.5 0 0 0-.85.36Z"
          fill="#1e293b" stroke="white" strokeWidth="1.5" />
      </motion.svg>
      {clicking && (
        <motion.div
          initial={{ scale: 0, opacity: 1 }}
          animate={{ scale: 2, opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="absolute top-0 left-0 w-4 h-4 bg-orange-400/30 rounded-full -translate-x-1 -translate-y-1"
        />
      )}
    </motion.div>
  );
}

function LiveDemo() {
  const [phase, setPhase] = useState(0);
  const [priceValue, setPriceValue] = useState(650000);
  const [cursorPos, setCursorPos] = useState({ x: 50, y: 100 });
  const [clicking, setClicking] = useState(false);
  const [showLead, setShowLead] = useState(false);

  useEffect(() => {
    const sequence = [
      () => { setCursorPos({ x: 80, y: 195 }); setTimeout(() => setPhase(1), 800); },
      () => {
        setClicking(true);
        setTimeout(() => { setPriceValue(720000); setCursorPos({ x: 140, y: 195 }); }, 200);
        setTimeout(() => { setPriceValue(785000); setCursorPos({ x: 200, y: 195 }); }, 600);
        setTimeout(() => { setClicking(false); setPhase(2); }, 1000);
      },
      () => { setCursorPos({ x: 150, y: 310 }); setTimeout(() => setPhase(3), 800); },
      () => { setClicking(true); setTimeout(() => { setClicking(false); setShowLead(true); setPhase(4); }, 300); },
      () => { setTimeout(() => setPhase(5), 2500); },
      () => { setShowLead(false); setPriceValue(650000); setCursorPos({ x: 50, y: 100 }); setTimeout(() => setPhase(0), 1000); },
    ];
    const timeout = setTimeout(() => sequence[phase](), phase === 0 ? 1500 : 100);
    return () => clearTimeout(timeout);
  }, [phase]);

  return (
    <section className="py-24 lg:py-36 bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <motion.h2 variants={fadeUp} custom={0} className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 mb-6">
            Watch Buyer Data{' '}
            <span className="bg-gradient-to-r from-orange-500 to-orange-600 bg-clip-text text-transparent">
              Flow In Live
            </span>
          </motion.h2>
          <motion.p variants={fadeUp} custom={0.1} className="text-xl text-slate-500 max-w-3xl mx-auto">
            Buyers submit price opinions. You get actionable intelligence.
            This is what your vendor report looks like — building in real time.
          </motion.p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="max-w-4xl mx-auto"
        >
          {/* Demo card */}
          <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <AnimatedCursor x={cursorPos.x} y={cursorPos.y} clicking={clicking} />

            <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
              {/* Price Opinion Side */}
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-slate-900">What would you pay?</h3>
                  <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">Anonymous</span>
                </div>
                <div className="mb-6">
                  <motion.div className="text-3xl font-bold text-slate-900 mb-2" key={priceValue}
                    initial={{ scale: 1.05 }} animate={{ scale: 1 }} transition={{ duration: 0.2 }}>
                    ${priceValue.toLocaleString()}
                  </motion.div>
                  <div className="relative h-3 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div className="absolute inset-y-0 left-0 bg-gradient-to-r from-orange-400 to-orange-600 rounded-full"
                      animate={{ width: `${((priceValue - 600000) / 300000) * 100}%` }} transition={{ duration: 0.3 }} />
                    <motion.div className="absolute top-1/2 -translate-y-1/2 w-5 h-5 bg-white border-2 border-orange-500 rounded-full shadow-lg"
                      animate={{ left: `calc(${((priceValue - 600000) / 300000) * 100}% - 10px)`, scale: clicking && phase === 1 ? 1.2 : 1 }}
                      transition={{ duration: 0.3 }} />
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 mt-2">
                    <span>$600k</span><span>$900k</span>
                  </div>
                </div>
                <motion.button
                  animate={{ scale: clicking && phase === 3 ? 0.95 : 1, boxShadow: clicking && phase === 3 ? '0 0 0 4px rgba(228,137,0,0.3)' : 'none' }}
                  className="w-full py-3 bg-gradient-to-r from-orange-400 to-orange-600 text-white font-semibold rounded-lg">
                  Submit Opinion
                </motion.button>
                <p className="text-xs text-slate-500 mt-3 text-center">This data goes straight to the agent&apos;s vendor report</p>
              </div>

              {/* Lead Card Side */}
              <div className="p-6 relative min-h-[280px]">
                <AnimatePresence>
                  {!showLead ? (
                    <motion.div key="placeholder" initial={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                      <div className="h-4 bg-slate-100 rounded w-2/3 animate-pulse" />
                      <div className="h-10 bg-slate-50 rounded animate-pulse" />
                      <div className="h-4 bg-slate-100 rounded w-1/2 animate-pulse" />
                      <div className="h-10 bg-slate-50 rounded animate-pulse" />
                      <div className="h-4 bg-slate-100 rounded w-1/3 animate-pulse" />
                    </motion.div>
                  ) : (
                    <motion.div key="leadCard"
                      initial={{ x: 300, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -300, opacity: 0 }}
                      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                      className="absolute inset-4 bg-white rounded-xl shadow-2xl border border-slate-200 p-4 overflow-hidden">
                      <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-600 to-violet-800 flex items-center justify-center text-white font-bold text-xs">JS</div>
                          <div>
                            <div className="font-semibold text-slate-900 text-sm">James Sullivan</div>
                            <div className="text-xs text-slate-500">0412 ••• •••</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5">
                          {[1,2,3,4,5].map(star => (
                            <svg key={star} className={`w-3 h-3 ${star<=4?'text-orange-400':'text-slate-200'}`} fill="currentColor" viewBox="0 0 20 20">
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                            </svg>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full flex items-center gap-1">
                          <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          Finance Approved
                        </span>
                        <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-medium rounded-full">Keen</span>
                      </div>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Budget:</span>
                          <span className="font-medium text-slate-900">$750k – $850k</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Timeline:</span>
                          <span className="font-medium text-slate-900">Ready now</span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="px-6 py-4 bg-gradient-to-r from-slate-50 to-orange-50/30 border-t border-slate-100">
              <p className="text-sm text-slate-600 text-center">
                <span className="font-medium text-slate-900">Buyers submit price opinions</span> on properties they&apos;re interested in —{' '}
                <span className="font-medium text-slate-900">you get the data and the lead.</span>
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════
// SECTION 6: HOW IT WORKS (DESIRE)
// ══════════════════════════════════════════════

function HowItWorks() {
  const steps = [
    {
      number: '01',
      title: 'Add the property',
      desc: 'Phone photos. Basic details. 2 minutes. Our AI handles the rest.',
      gradient: 'from-orange-500 to-orange-600',
    },
    {
      number: '02',
      title: 'Buyers give price opinions',
      desc: 'Share with your buyer network. They tell you what they\'d pay. Each opinion is a real data point.',
      gradient: 'from-blue-500 to-blue-600',
    },
    {
      number: '03',
      title: 'Educate on price with proof',
      desc: 'Walk into the vendor conversation with a median buyer price, opinion count, and demand signals. Evidence, not opinion.',
      gradient: 'from-emerald-500 to-emerald-600',
    },
  ];

  return (
    <section className="py-24 lg:py-36 bg-white relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.015]" style={{
        backgroundImage: `radial-gradient(circle at 1px 1px, rgb(0 0 0) 1px, transparent 0)`,
        backgroundSize: '40px 40px',
      }} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true }}
          className="text-center mb-20"
        >
          <motion.h2 variants={fadeUp} custom={0} className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 mb-6">
            Three Steps.{' '}
            <span className="bg-gradient-to-r from-orange-500 to-orange-600 bg-clip-text text-transparent">
              Real Evidence.
            </span>
          </motion.h2>
          <motion.p variants={fadeUp} custom={0.1} className="text-xl text-slate-500 max-w-2xl mx-auto">
            From phone photo to buyer-validated pricing in minutes — not months.
          </motion.p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
          {steps.map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.15 }}
              className="relative"
            >
              {/* Connecting line */}
              {i < steps.length - 1 && (
                <div className="hidden md:block absolute top-10 left-[60%] w-[80%] h-px bg-gradient-to-r from-slate-200 to-transparent z-0" />
              )}

              <div className="relative z-10">
                <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${step.gradient} flex items-center justify-center mb-6 shadow-lg`}>
                  <span className="text-3xl font-bold text-white">{step.number}</span>
                </div>
                <h3 className="text-2xl font-bold text-slate-900 mb-3">{step.title}</h3>
                <p className="text-slate-600 leading-relaxed text-lg">{step.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════
// SECTION 7: IPAD OPEN HOMES (DESIRE)
// ══════════════════════════════════════════════

function IPadOpenHomes() {
  return (
    <section className="py-24 lg:py-36 bg-gradient-to-b from-slate-50 to-white relative overflow-hidden">
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-br from-blue-500/5 to-purple-500/5 rounded-full blur-3xl" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true }}
          className="text-center mb-16"
        >
          <motion.div variants={fadeUp} custom={0}
            className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 px-4 py-2 rounded-full text-sm font-semibold mb-6">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            iPad at Open Homes
          </motion.div>
          <motion.h2 variants={fadeUp} custom={0.1}
            className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 mb-6">
            Stop Having The Awkward{' '}
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Price Conversation</span>
          </motion.h2>
          <motion.p variants={fadeUp} custom={0.2}
            className="text-xl text-slate-500 leading-relaxed max-w-3xl mx-auto">
            Hand buyers the iPad. Let 24 opinions tell the vendor what the market thinks.
            <br className="hidden sm:block" />
            <span className="font-semibold text-slate-700">You&apos;re not the bad guy anymore.</span>
          </motion.p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center mb-16">
          {/* iPad Visual */}
          <motion.div
            initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.2 }}
          >
            <div className="relative mx-auto max-w-md">
              <div className="bg-slate-900 rounded-[2rem] p-3 shadow-2xl">
                <div className="bg-white rounded-[1.5rem] overflow-hidden">
                  <div className="p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                        </svg>
                      </div>
                      <span className="font-bold text-slate-900 text-sm">Premarket</span>
                    </div>
                    <div className="bg-slate-100 rounded-xl h-28 mb-3 flex items-center justify-center">
                      <svg className="w-10 h-10 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                    </div>
                    <p className="text-xs font-semibold text-slate-900 mb-1">42 Harbour Street, Mosman</p>
                    <p className="text-[10px] text-slate-500 mb-4">4 bed &middot; 3 bath &middot; 2 car</p>
                    <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 rounded-xl p-4 mb-3">
                      <p className="text-xs font-bold text-slate-900 mb-2">What do you think this property is worth?</p>
                      <div className="flex gap-2">
                        <div className="flex-1 bg-white rounded-lg px-3 py-2 border border-orange-200">
                          <p className="text-[10px] text-slate-400">Your opinion</p>
                          <p className="text-sm font-bold text-slate-900">$2,850,000</p>
                        </div>
                        <button className="px-4 py-2 bg-orange-500 text-white text-xs font-bold rounded-lg">Submit</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-slate-50 rounded-lg p-2 text-center">
                        <p className="text-sm font-bold text-slate-900">24</p>
                        <p className="text-[9px] text-slate-500">Opinions</p>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-2 text-center">
                        <p className="text-sm font-bold text-orange-600">$2.7M</p>
                        <p className="text-[9px] text-slate-500">Median</p>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-2 text-center">
                        <p className="text-sm font-bold text-slate-900">8</p>
                        <p className="text-[9px] text-slate-500">Interested</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-10 h-1 bg-slate-600 rounded-full" />
            </div>
          </motion.div>

          {/* Steps */}
          <motion.div
            initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.3 }}
          >
            <h3 className="text-2xl font-bold text-slate-900 mb-6">Hand them the iPad. Let the data do the talking.</h3>
            <div className="space-y-6">
              {[
                { step: '1', title: 'Buyer walks through the property', desc: 'They check every room, love the kitchen, open every cupboard. The usual.' },
                { step: '2', title: 'You hand them the iPad before they leave', desc: '"Before you go — what do you reckon this place is worth?" Takes 10 seconds.' },
                { step: '3', title: 'Opinions stack up. The truth emerges.', desc: 'After 20+ opinions, you have a data-backed median price. Not your opinion — the market\'s.' },
                { step: '4', title: 'You walk into the vendor meeting with proof', desc: '"24 buyers came through. The median opinion is $2.7M." No awkward conversation. Just facts.' },
              ].map((item, i) => (
                <div key={i} className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
                    {item.step}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">{item.title}</p>
                    <p className="text-slate-600 text-sm mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Callout */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.3 }}
          className="max-w-4xl mx-auto"
        >
          <div className="bg-gradient-to-br from-blue-600 to-purple-700 rounded-2xl p-8 lg:p-10 shadow-2xl text-center text-white">
            <p className="text-xl lg:text-2xl font-bold mb-3">You didn&apos;t say their price was too high.</p>
            <p className="text-lg text-white/90 leading-relaxed max-w-2xl mx-auto">
              24 real buyers did. That&apos;s not your opinion — it&apos;s market evidence.
              And that changes every vendor conversation you&apos;ll ever have.
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════
// SECTION 9: DATA vs OPINION (DESIRE)
// ══════════════════════════════════════════════

function DataAdvantage() {
  return (
    <section className="py-24 lg:py-36 bg-white relative overflow-hidden">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} className="text-center mb-16">
          <motion.h2 variants={fadeUp} custom={0} className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 mb-6">
            CoreLogic Tells You What{' '}
            <span className="text-slate-400">Happened.</span>
            <br />
            Premarket Tells You What&apos;s{' '}
            <span className="bg-gradient-to-r from-orange-500 to-orange-600 bg-clip-text text-transparent">Happening.</span>
          </motion.h2>
          <motion.p variants={fadeUp} custom={0.1} className="text-xl text-slate-500 max-w-3xl mx-auto">
            Every other data provider uses past sales to predict current value.
            Premarket goes directly to the source: buyers.
          </motion.p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} transition={{ duration: 0.7 }}
          className="grid md:grid-cols-2 gap-6 lg:gap-8 mb-12"
        >
          {/* CoreLogic */}
          <div className="bg-slate-50 rounded-2xl p-8 border border-slate-200">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-slate-200 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-500">Traditional data providers</h3>
            </div>
            <div className="space-y-4">
              {[
                ['Source', 'Settlement records (past transactions)'],
                ['Timing', 'Weeks to months after a sale'],
                ['Method', 'Statistical models & extrapolation'],
                ['Updates', 'Monthly or quarterly'],
                ['Tells you', 'What similar homes sold for'],
              ].map(([label, value], i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="text-sm font-medium text-slate-400 w-20 flex-shrink-0">{label}</span>
                  <span className="text-sm text-slate-600">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Premarket */}
          <div className="bg-gradient-to-br from-orange-50 to-amber-50/50 rounded-2xl p-8 border-2 border-orange-200">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900">Premarket</h3>
            </div>
            <div className="space-y-4">
              {[
                ['Source', 'Buyer price opinions (direct input)'],
                ['Timing', 'Real time, as buyers engage'],
                ['Method', 'Direct measurement, not modelling'],
                ['Updates', 'Continuously, with every interaction'],
                ['Tells you', 'What buyers would pay today'],
              ].map(([label, value], i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="text-sm font-medium text-orange-500 w-20 flex-shrink-0">{label}</span>
                  <span className="text-sm text-slate-900 font-medium">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.2 }}
          className="max-w-3xl mx-auto text-center"
        >
          <p className="text-lg text-slate-600 leading-relaxed">
            It&apos;s not a better algorithm. It&apos;s a{' '}
            <span className="font-bold text-slate-900">better data source.</span>{' '}
            The algorithm doesn&apos;t need to be clever when the input is already the answer.
            Buyers <em>are</em> the market. Their opinions <em>are</em> the value.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════
// SECTION 10: VENDOR OFFER (DESIRE)
// ══════════════════════════════════════════════

function VendorOffer() {
  return (
    <section className="py-24 lg:py-36 bg-gradient-to-br from-emerald-900 via-slate-900 to-slate-900 text-white relative overflow-hidden">
      <div className="absolute inset-0 opacity-15">
        <div className="absolute top-0 left-1/3 w-[500px] h-[500px] bg-emerald-500 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-orange-500 rounded-full blur-3xl" />
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} className="text-center mb-12">
          <motion.div variants={fadeUp} custom={0}
            className="inline-flex items-center gap-2 bg-emerald-500/20 text-emerald-300 px-4 py-2 rounded-full text-sm font-semibold mb-6 border border-emerald-500/30">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Vendor-Paid
          </motion.div>

          <motion.h2 variants={fadeUp} custom={0.1} className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-6">
            $200 Campaign.{' '}
            <span className="bg-gradient-to-r from-emerald-400 to-emerald-300 bg-clip-text text-transparent">
              The Easiest Yes You&apos;ll Ever Get.
            </span>
          </motion.h2>
          <motion.p variants={fadeUp} custom={0.2} className="text-xl text-slate-300 leading-relaxed max-w-3xl mx-auto">
            Vendors are used to being asked for $5,000–$15,000 in marketing before a single buyer walks through.
            This is a different conversation entirely.
          </motion.p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-6 mb-12">
          <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.2 }}
            className="bg-white/5 backdrop-blur-sm rounded-2xl p-8 border border-white/10">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-red-500/20 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-red-400">The old conversation</h3>
            </div>
            <div className="space-y-4 text-slate-300">
              <p>&ldquo;We need $8,000 for a marketing campaign before we start...&rdquo;</p>
              <p>&ldquo;That covers portals, brochures, photography...&rdquo;</p>
              <p>&ldquo;No guarantees, but it&apos;s what the market expects...&rdquo;</p>
            </div>
            <div className="mt-6 pt-6 border-t border-white/10">
              <p className="text-sm text-red-400 font-semibold">Result: Vendor hesitates. Shops around. Lists with someone cheaper.</p>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.3 }}
            className="bg-emerald-500/10 backdrop-blur-sm rounded-2xl p-8 border border-emerald-500/20">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-emerald-400">The new conversation</h3>
            </div>
            <div className="space-y-4 text-slate-200">
              <p>&ldquo;Before we spend a cent on marketing, let&apos;s find out what buyers think.&rdquo;</p>
              <p>&ldquo;For $200, we get real price opinions from real buyers.&rdquo;</p>
              <p>&ldquo;You&apos;ll see exactly what the market says before committing to anything.&rdquo;</p>
            </div>
            <div className="mt-6 pt-6 border-t border-emerald-500/20">
              <p className="text-sm text-emerald-400 font-semibold">Result: Vendor says yes immediately. You&apos;ve got the listing.</p>
            </div>
          </motion.div>
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.4 }} className="text-center">
          <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-2xl p-8 lg:p-10 shadow-2xl shadow-emerald-500/20 max-w-3xl mx-auto">
            <p className="text-2xl lg:text-3xl font-bold text-white mb-4">Think about it from the vendor&apos;s side.</p>
            <p className="text-lg text-white/90 leading-relaxed">
              &ldquo;For $200, you&apos;ll know what real buyers think your home is worth — before you commit to anything.&rdquo;
              <br />
              <span className="text-emerald-200 font-semibold">That&apos;s not a cost. That&apos;s a no-brainer.</span>
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════
// SECTION 11: TESTIMONIALS (DESIRE)
// ══════════════════════════════════════════════

function Testimonials() {
  return (
    <section className="py-24 lg:py-36 bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} className="text-center mb-16">
          <motion.h2 variants={fadeUp} custom={0} className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 mb-6">
            Agents Are Already{' '}
            <span className="bg-gradient-to-r from-orange-500 to-orange-600 bg-clip-text text-transparent">Using Data to Win</span>
          </motion.h2>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} transition={{ duration: 0.6 }} className="max-w-4xl mx-auto mb-16">
          <div className="relative aspect-video rounded-2xl overflow-hidden shadow-lg">
            <iframe src="https://www.youtube.com/embed/909gXWhMV78" title="Agent Testimonial"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen className="w-full h-full" />
          </div>
        </motion.div>

        <div className="max-w-2xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.1 }}>
            <div className="bg-white rounded-2xl p-8 shadow-lg border border-slate-200 relative">
              <div className="absolute top-6 right-6 text-orange-200">
                <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.192 15.757c0-.88-.23-1.618-.69-2.217-.326-.412-.768-.683-1.327-.812-.55-.128-1.07-.137-1.54-.028-.16-.95.1-1.956.76-3.022.66-1.065 1.515-1.867 2.558-2.403L9.373 5c-.8.396-1.56.898-2.26 1.505-.71.607-1.34 1.305-1.9 2.094s-.98 1.68-1.25 2.69-.346 2.04-.217 3.1c.168 1.4.62 2.52 1.356 3.35.735.84 1.652 1.26 2.748 1.26.965 0 1.766-.29 2.4-.878.628-.576.94-1.365.94-2.368l.002.003zm9.124 0c0-.88-.23-1.618-.69-2.217-.326-.42-.77-.692-1.327-.817-.56-.124-1.074-.13-1.54-.022-.16-.94.09-1.95.75-3.02.66-1.06 1.514-1.86 2.557-2.4L18.49 5c-.8.396-1.555.898-2.26 1.505-.708.607-1.34 1.305-1.894 2.094-.556.79-.97 1.68-1.24 2.69-.273 1-.345 2.04-.217 3.1.165 1.4.615 2.52 1.35 3.35.732.833 1.646 1.25 2.742 1.25.967 0 1.768-.29 2.402-.876.627-.576.942-1.365.942-2.368v.01z" />
                </svg>
              </div>
              <p className="text-slate-700 text-lg leading-relaxed mb-6 relative z-10">
                &quot;The moment I stopped leading with my opinion and started leading with buyer data, everything changed.
                Less resistance. Better conversations. More listings.&quot;
              </p>
              <div className="flex items-center gap-4 pt-6 border-t border-slate-200">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white font-bold">G</div>
                <div>
                  <p className="font-semibold text-slate-900">Greg Costello</p>
                  <p className="text-sm text-slate-600">Kingscliff</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════
// SECTION 12: FINAL CTA (ACTION)
// ══════════════════════════════════════════════

function FinalCTA() {
  return (
    <section className="py-24 lg:py-36 bg-slate-950 text-white relative overflow-hidden">
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-500 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500 rounded-full blur-3xl" />
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }}>
          <motion.h2 variants={fadeUp} custom={0}
            className="text-3xl sm:text-4xl lg:text-6xl font-bold mb-6 leading-tight">
            Start Educating On Price{' '}
            <span className="bg-gradient-to-r from-orange-400 to-orange-300 bg-clip-text text-transparent">
              With Data.
            </span>
          </motion.h2>

          <motion.p variants={fadeUp} custom={0.15} className="text-xl lg:text-2xl text-slate-400 mb-4 leading-relaxed max-w-3xl mx-auto">
            Free for every agent. Set up in 2 minutes. Unlimited campaigns.
            No credit card. No catch.
          </motion.p>

          <motion.div variants={fadeUp} custom={0.3}
            className="flex flex-col sm:flex-row gap-4 justify-center items-center mt-12 mb-16">
            <motion.a
              href="/join"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              className="inline-flex items-center justify-center px-10 py-5 text-xl font-bold text-slate-900 bg-gradient-to-r from-orange-400 to-orange-500 rounded-xl shadow-2xl shadow-orange-500/30 hover:shadow-orange-500/50 transition-shadow duration-300"
            >
              Get Started Free
              <svg className="ml-3 w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </motion.a>
            <motion.a
              href="https://calendly.com/knockknock-premarket/30min"
              target="_blank"
              rel="noopener noreferrer"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              className="inline-flex items-center justify-center px-10 py-5 text-xl font-semibold text-white border border-white/20 rounded-xl hover:bg-white/5 transition-colors duration-300"
            >
              Book a Demo
              <svg className="ml-3 w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </motion.a>
          </motion.div>

          <motion.div variants={fadeUp} custom={0.45} className="max-w-3xl mx-auto">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-8 border border-white/10">
              <div className="grid sm:grid-cols-3 gap-8 text-center">
                <div>
                  <div className="w-12 h-12 mx-auto mb-3 bg-gradient-to-br from-orange-500/20 to-orange-600/10 border border-orange-500/20 rounded-xl flex items-center justify-center">
                    <svg className="w-6 h-6 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-white font-bold mb-1">Free for every agent</p>
                  <p className="text-sm text-slate-500">No subscription. No limits.</p>
                </div>
                <div>
                  <div className="w-12 h-12 mx-auto mb-3 bg-gradient-to-br from-orange-500/20 to-orange-600/10 border border-orange-500/20 rounded-xl flex items-center justify-center">
                    <svg className="w-6 h-6 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <p className="text-white font-bold mb-1">Set up in 2 minutes</p>
                  <p className="text-sm text-slate-500">Phone photos. Done.</p>
                </div>
                <div>
                  <div className="w-12 h-12 mx-auto mb-3 bg-gradient-to-br from-orange-500/20 to-orange-600/10 border border-orange-500/20 rounded-xl flex items-center justify-center">
                    <svg className="w-6 h-6 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <p className="text-white font-bold mb-1">Real buyer data</p>
                  <p className="text-sm text-slate-500">Evidence, not opinions.</p>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════

export default function HomepageV2() {
  return (
    <>
      <HeroSection />

      <TheProblem />
      <PriceEducationReveal />
      <LiveDemo />
      <HowItWorks />
      <IPadOpenHomes />
      <DataAdvantage />
      <VendorOffer />
      <Testimonials />
      <FinalCTA />
    </>
  );
}
