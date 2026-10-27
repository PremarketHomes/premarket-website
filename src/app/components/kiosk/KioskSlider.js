'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { roundToStep } from '../../utils/priceOpinionStep';

// A deliberate grab is the thumb itself (generous touch target) or a drag that
// travels at least this far. A quick tap or brush elsewhere on the track does
// nothing, so stray touches can't register an opinion.
const THUMB_GRAB_PX = 60;
const ARM_DISTANCE_PX = 10;

const haptic = () => {
  try { if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(8); } catch { /* unsupported */ }
};

/**
 * Large touch slider for the open-home kiosk. Pointer Events with pointer
 * capture so the release is ALWAYS delivered (even if the finger leaves the
 * control), pointercancel/app-switch discards instead of saving, a second
 * finger is ignored, and it is fully keyboard/switch-control operable
 * (role="slider"). It reports gestures only; it never saves anything.
 */
export default function KioskSlider({
  min,
  max,
  step,
  value,
  disabled = false,
  invite = false,
  ariaLabel = 'Your price opinion',
  valueText,
  onGestureStart, // () => boolean — false when the controller refuses (e.g. straggler touch)
  onGestureMove,  // (value) => void
  onGestureEnd,   // ({ cancelled }) => void
}) {
  const trackRef = useRef(null);
  const gesture = useRef({ id: null, armed: false, startX: 0 });
  const kbActive = useRef(false);
  const lastValue = useRef(value);
  const [dragging, setDragging] = useState(false);

  useEffect(() => { lastValue.current = value; }, [value]);

  const ratio = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;

  const valueFromX = useCallback((clientX) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return lastValue.current;
    const r = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.min(max, Math.max(min, roundToStep(min + r * (max - min), step)));
  }, [min, max, step]);

  const arm = useCallback(() => {
    if (gesture.current.armed) return true;
    const accepted = onGestureStart();
    if (accepted === false) {
      gesture.current = { id: null, armed: false, startX: 0 };
      return false;
    }
    gesture.current.armed = true;
    setDragging(true);
    return true;
  }, [onGestureStart]);

  const finish = useCallback((cancelled) => {
    const wasArmed = gesture.current.armed;
    gesture.current = { id: null, armed: false, startX: 0 };
    setDragging(false);
    if (wasArmed) onGestureEnd({ cancelled });
  }, [onGestureEnd]);

  const onPointerDown = (e) => {
    if (disabled) return;
    if (gesture.current.id !== null) return; // a second finger / pointer is ignored
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    gesture.current = { id: e.pointerId, armed: false, startX: e.clientX };
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* not supported */ }
    const rect = trackRef.current?.getBoundingClientRect();
    const thumbX = rect ? rect.left + ratio * rect.width : e.clientX;
    if (Math.abs(e.clientX - thumbX) <= THUMB_GRAB_PX) arm();
  };

  const onPointerMove = (e) => {
    const g = gesture.current;
    if (g.id !== e.pointerId) return;
    if (!g.armed) {
      if (Math.abs(e.clientX - g.startX) < ARM_DISTANCE_PX) return;
      if (!arm()) return;
    }
    const next = valueFromX(e.clientX);
    if (next !== lastValue.current) {
      lastValue.current = next;
      haptic();
      onGestureMove(next);
    }
  };

  const onPointerUp = (e) => {
    if (gesture.current.id !== e.pointerId) return;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* already released */ }
    finish(false);
  };

  const onPointerCancel = (e) => {
    if (gesture.current.id !== e.pointerId) return;
    finish(true);
  };

  // Lost capture after a normal pointerup is a no-op (gesture already finished);
  // if capture is lost any other way the attempt is discarded, not saved.
  const onLostPointerCapture = (e) => {
    if (gesture.current.id !== e.pointerId) return;
    finish(true);
  };

  // A system interruption (app switch, notification pull-down, screen lock)
  // while a finger is down must discard the attempt.
  useEffect(() => {
    const interrupt = () => { if (gesture.current.armed || kbActive.current) { kbActive.current = false; finish(true); } };
    const onVisibility = () => { if (document.hidden) interrupt(); };
    window.addEventListener('blur', interrupt);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', interrupt);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [finish]);

  const onKeyDown = (e) => {
    if (disabled) return;
    const big = step * 10;
    let next = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = lastValue.current - step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = lastValue.current + step;
    else if (e.key === 'PageDown') next = lastValue.current - big;
    else if (e.key === 'PageUp') next = lastValue.current + big;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    if (next === null) return;
    e.preventDefault();
    next = Math.min(max, Math.max(min, next));
    if (!kbActive.current) {
      if (onGestureStart() === false) return;
      kbActive.current = true;
    }
    if (next !== lastValue.current) {
      lastValue.current = next;
      onGestureMove(next);
    }
  };

  const onKeyUp = () => {
    if (!kbActive.current) return;
    kbActive.current = false;
    onGestureEnd({ cancelled: false });
  };

  const pct = `${(ratio * 100).toFixed(3)}%`;

  return (
    <div className="relative w-full select-none" style={{ touchAction: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-orientation="horizontal"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onLostPointerCapture}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onContextMenu={(e) => e.preventDefault()}
        className="relative h-28 w-full cursor-pointer outline-none focus-visible:ring-4 focus-visible:ring-white/70 rounded-3xl"
        style={{ touchAction: 'none' }}
        data-testid="kiosk-slider"
      >
        {/* Track */}
        <div ref={trackRef} className="absolute left-0 right-0 top-1/2 h-4 -translate-y-1/2 rounded-full bg-white/25 backdrop-blur-sm shadow-inner">
          <div
            className="h-full rounded-full"
            style={{
              width: pct,
              // Bright fill so it reads on any photo/brand (a navy brand colour disappears on the dark
              // overlay); the brand colour lives in the thumb ring and glow instead.
              background: 'linear-gradient(90deg, rgba(255,255,255,.65), #ffffff)',
              boxShadow: '0 0 18px var(--brand-primary, #e48900)',
            }}
          />
        </div>

        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ left: pct }}
          data-testid="kiosk-thumb"
        >
          <div
            className={`relative h-[68px] w-[68px] rounded-full bg-white shadow-2xl transition-transform duration-150 ${dragging ? 'scale-110' : ''} ${invite && !dragging ? 'pm-kiosk-invite' : ''}`}
            style={{ border: '6px solid var(--brand-primary, #e48900)' }}
          >
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pm-kiosk-invite { 0%,100% { box-shadow: 0 0 0 0 rgba(255,255,255,.55); } 50% { box-shadow: 0 0 0 18px rgba(255,255,255,0); } }
        .pm-kiosk-invite { animation: pm-kiosk-invite 2.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .pm-kiosk-invite { animation: none; }
        }
      `}</style>
    </div>
  );
}
