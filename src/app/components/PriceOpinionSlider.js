'use client';

import { useEffect, useRef } from 'react';
// Re-exported for backward compatibility — every existing call site
// imports these from here. Moved to a plain, JSX-free util (no
// `'use client'`, no <style jsx>) so pure logic like
// utils/priceOpinionRange.js can depend on them without pulling this
// whole component — and its styled-jsx syntax — into contexts (like
// Vitest, which has no JSX loader configured for plain .js files
// outside of Next's own compiler) that can't parse it.
import { PRICE_OPINION_STEP, roundToStep } from '../utils/priceOpinionStep';
export { PRICE_OPINION_STEP, roundToStep };

// Fires a very short, subtle vibration if the platform supports it.
// Silently does nothing on browsers/devices without the Vibration API
// (notably iPhone Safari, in-browser or installed as a home-screen app —
// WebKit has no public API for this, so there is no workaround to add).
function triggerStepHaptic() {
  if (typeof navigator === 'undefined') return;
  if (typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(8);
  } catch {
    // Some browsers can throw if called outside a user-gesture context —
    // never let a haptic failure interrupt the slider interaction.
  }
}

/**
 * Shared price-opinion slider used by every buyer/opinion-giver flow
 * (property page, sticky bars, iPad kiosk mode, TV display kiosk).
 * Moves in $10,000 increments and gives one subtle haptic pulse per
 * increment crossed, on devices that support it.
 */
export default function PriceOpinionSlider({
  value,
  min,
  max,
  onChange,
  onSlideStart,
  onSlideEnd,
  step = PRICE_OPINION_STEP,
  className,
  ariaLabel = 'Price opinion',
  trackFill = true,
  invitePulse = false,
}) {
  const lastStepIndexRef = useRef(Math.round((value - min) / step));

  // Resync the baseline whenever the value changes for a reason other than
  // the user dragging (property switch, restored offer, reset to midpoint)
  // so the next drag doesn't fire a spurious or missing haptic pulse.
  useEffect(() => {
    lastStepIndexRef.current = Math.round((value - min) / step);
  }, [value, min, step]);

  const handleChange = (e) => {
    const nextValue = Number(e.target.value);
    const nextStepIndex = Math.round((nextValue - min) / step);
    if (nextStepIndex !== lastStepIndexRef.current) {
      lastStepIndexRef.current = nextStepIndex;
      triggerStepHaptic();
    }
    onChange(nextValue);
  };

  // The track itself shows how far the current value sits across the
  // range — a filled brand-gradient segment up to the thumb, a quiet
  // translucent remainder after it — computed here so every call site
  // gets the same "real control, not a flat bar" treatment for free,
  // from the one shared component. The iPad kiosk slider opts out
  // (trackFill={false}) since it already has its own deliberate
  // orange-to-green sentiment gradient baked into its className.
  const fillPercent = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  const trackStyle = trackFill
    ? {
        background: `linear-gradient(to right, var(--brand-primary, #c2410c) 0%, var(--brand-primary-dark, #c64500) ${fillPercent}%, rgba(100, 116, 139, 0.18) ${fillPercent}%, rgba(100, 116, 139, 0.18) 100%)`,
      }
    : undefined;

  // A soft, slow glow pulse on the thumb invites the first touch —
  // never shown once the buyer has actually interacted (the caller
  // only passes invitePulse while !hasInteracted), and skipped
  // entirely under prefers-reduced-motion (see the media query below).
  const inputClassName = invitePulse ? `${className} invite-pulse` : className;

  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        onMouseDown={onSlideStart}
        onMouseUp={onSlideEnd}
        onTouchStart={onSlideStart}
        onTouchEnd={onSlideEnd}
        className={inputClassName}
        style={trackStyle}
        aria-label={ariaLabel}
      />
      {/* Thumb styling for every call site. Moved here (rather than left in
          each page) because styled-jsx only scopes to elements written
          directly in the component that declares the <style jsx> block —
          it would not have matched this <input> from the caller's file. */}
      <style jsx>{`
        .ipad-slider::-webkit-slider-thumb {
          appearance: none;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: white;
          cursor: pointer;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
          border: 4px solid var(--brand-primary, #ea580c);
        }
        .ipad-slider::-moz-range-thumb {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: white;
          cursor: pointer;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
          border: 4px solid var(--brand-primary, #ea580c);
        }

        .slider-thumb::-webkit-slider-thumb {
          appearance: none;
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: radial-gradient(
            circle at center,
            var(--brand-primary, #c2410c) 0 7px,
            white 7px 100%
          );
          cursor: pointer;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
          border: 3px solid var(--brand-primary, #c2410c);
        }
        .slider-thumb::-moz-range-thumb {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: radial-gradient(
            circle at center,
            var(--brand-primary, #c2410c) 0 7px,
            white 7px 100%
          );
          cursor: pointer;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
          border: 3px solid var(--brand-primary, #c2410c);
        }

        .sticky-slider::-webkit-slider-thumb {
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: linear-gradient(to right, var(--brand-primary, #e48900), var(--brand-primary-dark, #c64500));
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(228, 137, 0, 0.4);
          border: 2px solid white;
        }
        .sticky-slider::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: linear-gradient(to right, var(--brand-primary, #e48900), var(--brand-primary-dark, #c64500));
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(228, 137, 0, 0.4);
          border: 2px solid white;
        }

        @keyframes invite-pulse-glow {
          0%,
          100% {
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25), 0 0 0 0 rgba(194, 65, 12, 0.35);
          }
          50% {
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25), 0 0 0 9px rgba(194, 65, 12, 0);
          }
        }
        /* Respect reduced-motion: the invite-pulse glow only runs when
           the platform says motion is welcome. With a preference set,
           the thumb simply keeps its normal, static appearance. */
        @media (prefers-reduced-motion: no-preference) {
          .invite-pulse::-webkit-slider-thumb {
            animation: invite-pulse-glow 2.2s ease-in-out infinite;
          }
          .invite-pulse::-moz-range-thumb {
            animation: invite-pulse-glow 2.2s ease-in-out infinite;
          }
        }
      `}</style>
    </>
  );
}
