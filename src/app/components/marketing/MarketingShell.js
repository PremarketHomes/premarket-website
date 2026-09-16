'use client';

/**
 * Shared building blocks for marketing pages (Solutions / Features / Premarket).
 *
 * Brand approach:
 *   - Light theme everywhere. Generous whitespace.
 *   - Icons sit alone (no colored pills behind them). Brand orange for primary
 *     accents, slate for secondary.
 *   - The 2×2 grid BrandMark is the recurring brand anchor — used as section
 *     ornament and CTA accent.
 *   - Buttons are pill-shaped, single solid orange. No gradients on chrome.
 *   - REA-style refinement: confident type, generous spacing, subtle motion.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, useInView } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import BrandMark from '../BrandMark';
import { playfairFontStyle } from './typography';
import { GradientMesh, HeroFloatingDecor, TiltCard } from './WowFactor';

// ---------- Motion variants ----------

export const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: (delay = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] },
  }),
};

export const fadeIn = {
  hidden: { opacity: 0 },
  visible: (delay = 0) => ({
    opacity: 1,
    transition: { duration: 0.6, delay },
  }),
};

export const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

// ---------- Eyebrow ----------

/**
 * Eyebrow — short uppercase label above a section heading.
 * Uses the BrandMark as ornament instead of an icon-in-pill.
 */
export function Eyebrow({ children, className = '' }) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.6 }}
      className={`inline-flex items-center gap-2.5 ${className}`}
    >
      <BrandMark size={14} />
      <span className="text-[11px] font-bold text-[#c64500] uppercase tracking-[0.18em]">
        {children}
      </span>
    </motion.div>
  );
}

// ---------- SectionHeading ----------

export function SectionHeading({ eyebrow, title, subtitle, align = 'left', children }) {
  const alignClass = align === 'center' ? 'text-center mx-auto' : 'text-left';
  return (
    <div className={`max-w-3xl ${alignClass}`}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <motion.h2
        variants={fadeUp}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.4 }}
        custom={0.05}
        className="mt-6 text-4xl sm:text-5xl lg:text-[3.5rem] tracking-tight text-slate-900 leading-[1.04]"
        style={playfairFontStyle}
      >
        {title}
      </motion.h2>
      {subtitle && (
        <motion.p
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.4 }}
          custom={0.12}
          className="mt-6 text-lg sm:text-xl text-slate-600 leading-relaxed"
        >
          {subtitle}
        </motion.p>
      )}
      {children}
    </div>
  );
}

// ---------- AnimatedCounter ----------

export function AnimatedCounter({
  value,
  prefix = '',
  suffix = '',
  duration = 1800,
  className = '',
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!inView) return;
    let start;
    let raf;
    function step(t) {
      if (!start) start = t;
      const elapsed = t - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setN(Math.round(eased * value));
      if (progress < 1) raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => raf && cancelAnimationFrame(raf);
  }, [inView, value, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {n.toLocaleString()}
      {suffix}
    </span>
  );
}

// ---------- BreakoutStats ----------

/**
 * Three-column stat block. White background, hairline dividers, generous
 * padding. No colored fills.
 */
export function BreakoutStats({ stats }) {
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.3 }}
      className="grid grid-cols-1 sm:grid-cols-3 bg-white rounded-3xl border border-slate-200 shadow-[0_1px_0_rgba(15,23,42,0.04),0_24px_60px_-30px_rgba(15,23,42,0.12)] divide-y sm:divide-y-0 sm:divide-x divide-slate-100"
    >
      {stats.map((s, i) => (
        <motion.div key={i} variants={fadeUp} className="p-10 sm:p-12">
          {s.eyebrow && (
            <p className="text-[10px] font-bold text-[#c64500] uppercase tracking-[0.18em] mb-4">
              {s.eyebrow}
            </p>
          )}
          <div className="text-5xl sm:text-6xl font-bold text-slate-900 tracking-tight leading-none">
            {typeof s.value === 'number' ? (
              <AnimatedCounter
                value={s.value}
                prefix={s.prefix || ''}
                suffix={s.suffix || ''}
              />
            ) : (
              s.value
            )}
          </div>
          <p className="mt-5 text-base text-slate-600 leading-relaxed">{s.label}</p>
        </motion.div>
      ))}
    </motion.div>
  );
}

// ---------- FeatureCard ----------

/**
 * FeatureCard — white card, plain icon (no colored pill), clean type, lift on hover.
 *
 * `accent` controls only the icon and link color. The card itself stays
 * neutral white so the brand reads as confident and refined, not cartoon.
 */
export function FeatureCard({ icon: Icon, title, description, href, accent = 'orange' }) {
  const accents = {
    orange: 'text-[#e48900]',
    slate: 'text-slate-900',
    blue: 'text-blue-600',
    emerald: 'text-emerald-600',
    violet: 'text-violet-600',
    rose: 'text-rose-600',
  };
  const iconColor = accents[accent] || accents.orange;

  const inner = (
    <motion.div variants={fadeUp} className="h-full">
      <TiltCard max={5} className="h-full">
        <div className="group h-full bg-white border border-slate-200 rounded-3xl p-8 sm:p-10 shadow-[0_1px_0_rgba(15,23,42,0.04)] hover:shadow-[0_24px_60px_-30px_rgba(15,23,42,0.18)] hover:border-slate-300 transition-all">
          {Icon && <Icon className={`w-7 h-7 ${iconColor}`} strokeWidth={1.75} />}
          <h3 className="mt-7 text-[1.35rem] sm:text-2xl font-bold text-slate-900 leading-tight tracking-tight">
            {title}
          </h3>
          <p className="mt-3 text-base text-slate-600 leading-relaxed">{description}</p>
          {href && (
            <div className={`mt-7 inline-flex items-center gap-1.5 text-sm font-semibold ${iconColor}`}>
              Learn more
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </div>
          )}
        </div>
      </TiltCard>
    </motion.div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {inner}
      </Link>
    );
  }
  return inner;
}

// ---------- Quote / pull-quote ----------

export function PullQuote({ quote, author, role }) {
  return (
    <motion.figure
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.3 }}
      className="relative max-w-3xl mx-auto text-center px-6"
    >
      <div className="flex justify-center mb-8">
        <BrandMark size={36} />
      </div>
      <blockquote className="relative text-2xl sm:text-[2rem] font-medium text-slate-800 leading-snug tracking-tight">
        {quote}
      </blockquote>
      {(author || role) && (
        <figcaption className="mt-8 text-sm text-slate-500">
          {author && <span className="font-semibold text-slate-700">{author}</span>}
          {role && <span> · {role}</span>}
        </figcaption>
      )}
    </motion.figure>
  );
}

// ---------- BulletList ----------

export function BulletList({ items, accent = 'orange' }) {
  const dot = {
    orange: 'bg-[#e48900]',
    blue: 'bg-blue-500',
    emerald: 'bg-emerald-500',
    violet: 'bg-violet-500',
    slate: 'bg-slate-900',
  };
  return (
    <motion.ul
      variants={stagger}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.3 }}
      className="space-y-5"
    >
      {items.map((it, i) => (
        <motion.li key={i} variants={fadeUp} className="flex items-start gap-4">
          <span
            className={`mt-2.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot[accent] || dot.orange}`}
          />
          <div>
            {it.title && (
              <p className="text-base font-bold text-slate-900">{it.title}</p>
            )}
            <p className="text-base text-slate-600 leading-relaxed">{it.body}</p>
          </div>
        </motion.li>
      ))}
    </motion.ul>
  );
}

// ---------- CTA Buttons ----------
//
// These are the marketing-page wrappers around the canonical button styles in
// components/marketing/Loading.js. Re-exported here so existing pages keep
// working. The shape: solid orange pill primary + neutral pill ghost.

export function PrimaryButton({ href, children, className = '' }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 px-7 py-3.5 bg-[#e48900] text-white text-sm font-semibold rounded-xl hover:opacity-90 active:scale-[0.98] transition-all ${className}`}
    >
      {children}
      <ArrowRight className="w-4 h-4" />
    </Link>
  );
}

export function GhostButton({ href, children, className = '' }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 px-7 py-3.5 bg-white border border-slate-300 text-slate-800 text-sm font-semibold rounded-xl hover:border-slate-400 active:scale-[0.98] transition-all ${className}`}
    >
      {children}
    </Link>
  );
}

// ---------- ClosingCTA ----------

/**
 * Light themed closing CTA — replaces the old dark gradient block.
 * Pure white with a subtle BrandMark watermark, big confident type,
 * solid orange primary button.
 */
export function ClosingCTA({
  eyebrow = 'Ready when you are',
  title,
  subtitle,
  primaryHref = '/signup',
  primaryLabel = 'Create free account',
  secondaryHref = '/contact',
  secondaryLabel = 'Talk to us',
}) {
  return (
    <motion.section
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.3 }}
      className="relative max-w-6xl mx-auto px-4 sm:px-6 py-24 sm:py-32"
    >
      <div className="relative overflow-hidden rounded-[2.5rem] bg-white border border-slate-200 px-8 sm:px-16 py-20 sm:py-24 text-center shadow-[0_60px_120px_-60px_rgba(15,23,42,0.18)]">
        {/* watermark */}
        <div className="pointer-events-none absolute -top-12 -right-12 opacity-[0.06]">
          <BrandMark size={260} />
        </div>
        <div className="pointer-events-none absolute -bottom-16 -left-12 opacity-[0.04]">
          <BrandMark size={200} />
        </div>

        <div className="relative">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2
            className="mt-6 text-4xl sm:text-5xl lg:text-6xl tracking-tight text-slate-900 leading-[1.04]"
            style={playfairFontStyle}
          >
            {title}
          </h2>
          {subtitle && (
            <p className="mt-6 text-lg sm:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
              {subtitle}
            </p>
          )}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <PrimaryButton href={primaryHref}>{primaryLabel}</PrimaryButton>
            <GhostButton href={secondaryHref}>{secondaryLabel}</GhostButton>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

// ---------- Hero (large hero used by every marketing page) ----------

/**
 * Light, refined hero. White → faint orange wash. BrandMark watermark in the
 * background. Centered title, generous whitespace.
 */
export function MarketingHero({ eyebrow, title, subtitle, primaryCta, secondaryCta, children, showDecor = false }) {
  return (
    <section className="relative overflow-hidden bg-white pt-24 sm:pt-32 pb-20 sm:pb-28">
      {/* animated gradient mesh */}
      <GradientMesh />
      {/* faint orange wash on top to soften the mesh */}
      <div className="absolute inset-x-0 top-0 h-[680px] bg-gradient-to-b from-orange-50/40 via-white/60 to-white pointer-events-none" />

      {/* large brand mark watermark */}
      <div className="pointer-events-none absolute -top-20 -right-24 opacity-[0.05]">
        <BrandMark size={520} />
      </div>
      <div className="pointer-events-none absolute top-32 -left-32 opacity-[0.04]">
        <BrandMark size={360} />
      </div>

      {showDecor && <HeroFloatingDecor />}

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 text-center">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <motion.h1
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={0.05}
          className="mt-7 text-5xl sm:text-6xl lg:text-7xl tracking-tight text-slate-900 leading-[1.02]"
          style={playfairFontStyle}
        >
          {title}
        </motion.h1>
        {subtitle && (
          <motion.p
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={0.15}
            className="mt-8 text-xl sm:text-2xl text-slate-600 max-w-3xl mx-auto leading-relaxed"
          >
            {subtitle}
          </motion.p>
        )}
        {(primaryCta || secondaryCta) && (
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={0.25}
            className="mt-12 flex flex-wrap items-center justify-center gap-3"
          >
            {primaryCta && <PrimaryButton href={primaryCta.href}>{primaryCta.label}</PrimaryButton>}
            {secondaryCta && <GhostButton href={secondaryCta.href}>{secondaryCta.label}</GhostButton>}
          </motion.div>
        )}
        {children}
      </div>
    </section>
  );
}

// ---------- TwoColumn ----------

export function TwoColumn({ left, right, reverse = false }) {
  return (
    <div
      className={`grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-24 items-center ${
        reverse ? 'lg:[&>div:first-child]:order-2' : ''
      }`}
    >
      <motion.div
        variants={fadeUp}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
      >
        {left}
      </motion.div>
      <motion.div
        variants={fadeUp}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
        custom={0.1}
      >
        {right}
      </motion.div>
    </div>
  );
}

// ---------- Brand divider ----------

/**
 * BrandDivider — a small centered BrandMark used as a visual rest between
 * sections. Adds rhythm to long marketing pages without needing colored
 * dividers or images.
 */
export function BrandDivider({ className = '' }) {
  return (
    <div className={`flex items-center justify-center gap-4 py-8 ${className}`}>
      <span className="h-px w-16 bg-slate-200" />
      <BrandMark size={20} />
      <span className="h-px w-16 bg-slate-200" />
    </div>
  );
}
