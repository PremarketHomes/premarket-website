'use client';

import { useEffect, useRef } from 'react';

// Single source of truth for the price-opinion slider increment.
// Only affects new slider interactions — never touches previously stored offers.
export const PRICE_OPINION_STEP = 10000;

// Rounds a display-only value (min/max range bounds, midpoints, restored
// previous-offer values) to the nearest slider step. Never used on stored
// Firestore data — only on values computed fresh for the current session.
export function roundToStep(value, step = PRICE_OPINION_STEP) {
  return Math.round(value / step) * step;
}

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
        className={className}
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
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: white;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
          border: 3px solid var(--brand-primary, #ea580c);
        }
        .slider-thumb::-moz-range-thumb {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: white;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
          border: 3px solid var(--brand-primary, #ea580c);
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
      `}</style>
    </>
  );
}
