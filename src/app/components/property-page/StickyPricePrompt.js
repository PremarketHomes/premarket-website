'use client';

import { motion, AnimatePresence } from 'framer-motion';

/**
 * The floating reminder that the real price-opinion card is still
 * waiting, once a buyer has scrolled past it without answering.
 *
 * Replaces the old sticky bar — a full second slider in a dark gradient
 * slab that led only to "Register Interest," never to actually
 * finishing the opinion. This one is deliberately smaller and does
 * exactly one thing: point back at the single real interaction. It
 * never opens a modal and never writes anything itself — tapping it
 * only scrolls the real card into view (see `onTap`, wired up in
 * PropertyPageClient.js). That boundary is what makes this component
 * safe to add at all: there is no path from here to Firestore.
 *
 * Two content states, controlled by `hasInteracted`:
 *   - before any drag: an invitation ("Have a go — what's it worth?")
 *   - after the first drag: a live mirror of the buyer's own number,
 *     so it reads as an unfinished action to complete, not a repeated ask
 *
 * All visibility logic (when to show/hide) lives in
 * utils/stickyPromptVisibility.js and is computed by the caller — this
 * component only renders what it's told to.
 */
export default function StickyPricePrompt({ visible, priceOpinion, hasInteracted, formatMoney, onTap }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          className="fixed inset-x-0 z-40 flex justify-center px-4"
          style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <button
            onClick={onTap}
            className="flex items-center gap-3 bg-white border border-slate-200 rounded-full shadow-lg pl-5 pr-4 py-3 max-w-sm w-full sm:w-auto text-left"
          >
            {hasInteracted ? (
              <>
                <span
                  className="text-xl font-semibold text-[var(--brand-primary,#c2410c)] tabular-nums flex-shrink-0"
                  style={{ fontFamily: 'var(--font-playfair, serif)' }}
                >
                  {formatMoney(priceOpinion)}
                </span>
                <span className="text-xs text-slate-500 font-medium flex-1">Your price opinion — tap to finish</span>
              </>
            ) : (
              <>
                <span className="flex-1 min-w-0">
                  <span
                    className="block text-[15px] font-semibold text-slate-900"
                    style={{ fontFamily: 'var(--font-playfair, serif)' }}
                  >
                    Have a go — what&rsquo;s it worth?
                  </span>
                  <span className="block text-xs text-slate-400 mt-0.5">Anonymous &middot; takes 10 seconds</span>
                </span>
              </>
            )}
            <svg
              className="w-4 h-4 text-[var(--brand-primary,#c2410c)] flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
