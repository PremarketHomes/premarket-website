'use client';

/**
 * Loading primitives — Spinner, Skeleton, SkeletonCard, plus button variants
 * with built-in loading state.
 *
 * Used everywhere a brand-consistent loading state is needed: form submits,
 * property listings, dashboards, hero placeholders, etc.
 */

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

// ---------- Spinner ----------

export function Spinner({ size = 16, className = '', strokeColor = 'currentColor' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`animate-spin ${className}`}
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke={strokeColor}
        strokeWidth="3"
        opacity="0.2"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke={strokeColor}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------- Loading dots ----------

export function LoadingDots({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} aria-hidden="true">
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-loading-dot" />
      <span
        className="w-1.5 h-1.5 rounded-full bg-current animate-loading-dot"
        style={{ animationDelay: '0.15s' }}
      />
      <span
        className="w-1.5 h-1.5 rounded-full bg-current animate-loading-dot"
        style={{ animationDelay: '0.3s' }}
      />
      <style jsx>{`
        @keyframes loading-dot {
          0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-2px); }
        }
        .animate-loading-dot {
          animation: loading-dot 1s ease-in-out infinite;
        }
      `}</style>
    </span>
  );
}

// ---------- Skeleton ----------

export function Skeleton({ className = '', rounded = 'rounded-lg' }) {
  return (
    <div
      className={`relative overflow-hidden bg-slate-100 ${rounded} ${className}`}
      aria-hidden="true"
    >
      <div className="absolute inset-0 -translate-x-full animate-skeleton-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
      <style jsx>{`
        @keyframes skeleton-shimmer {
          100% { transform: translateX(100%); }
        }
        .animate-skeleton-shimmer {
          animation: skeleton-shimmer 1.6s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

// ---------- SkeletonText (multiple lines) ----------

export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`}
        />
      ))}
    </div>
  );
}

// ---------- SkeletonCard (property listing placeholder) ----------

export function SkeletonCard() {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <Skeleton className="aspect-[16/10] w-full" rounded="" />
      <div className="p-5 space-y-3">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex gap-3 pt-1">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-12" />
        </div>
        <div className="pt-3 border-t border-slate-100 flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" rounded="" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Button primitives with isLoading ----------

const PRIMARY_BASE =
  'inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-[#e48900] text-white text-sm font-semibold rounded-xl hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-70 disabled:cursor-not-allowed';

const GHOST_BASE =
  'inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-white border border-slate-300 text-slate-800 text-sm font-semibold rounded-xl hover:border-slate-400 active:scale-[0.98] transition-all disabled:opacity-70 disabled:cursor-not-allowed';

/**
 * ButtonPrimary — solid orange CTA. Renders <button>, <a>, or Link.
 * Use `href` for navigation, `onClick`/`type` for actions.
 */
export function ButtonPrimary({
  href,
  children,
  className = '',
  isLoading = false,
  loadingLabel,
  disabled = false,
  trailingIcon = true,
  type,
  onClick,
  ...rest
}) {
  const content = (
    <>
      {isLoading && <Spinner size={14} strokeColor="white" />}
      {isLoading ? (loadingLabel || children) : children}
      {!isLoading && trailingIcon && <ArrowRight className="w-4 h-4" />}
    </>
  );

  if (href && !disabled && !isLoading) {
    return (
      <Link href={href} className={`${PRIMARY_BASE} ${className}`} {...rest}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`${PRIMARY_BASE} ${className}`}
      {...rest}
    >
      {content}
    </button>
  );
}

/**
 * ButtonGhost — white border CTA. Same API as ButtonPrimary.
 */
export function ButtonGhost({
  href,
  children,
  className = '',
  isLoading = false,
  loadingLabel,
  disabled = false,
  type,
  onClick,
  ...rest
}) {
  const content = (
    <>
      {isLoading && <Spinner size={14} />}
      {isLoading ? (loadingLabel || children) : children}
    </>
  );

  if (href && !disabled && !isLoading) {
    return (
      <Link href={href} className={`${GHOST_BASE} ${className}`} {...rest}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`${GHOST_BASE} ${className}`}
      {...rest}
    >
      {content}
    </button>
  );
}

// ---------- Page-level loader (full screen) ----------

export function PageLoader({ label = 'Loading' }) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-slate-500">
      <Spinner size={32} strokeColor="#e48900" />
      <p className="mt-4 text-sm font-medium tracking-wide uppercase">{label}</p>
    </div>
  );
}
