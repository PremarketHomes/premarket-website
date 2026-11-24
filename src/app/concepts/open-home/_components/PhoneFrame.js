'use client';

import { forwardRef } from 'react';

export const SCREEN_W = 390;
export const SCREEN_H = 844;

/**
 * A modern phone, drawn in CSS, around a real 390x844 screen (an iPhone's CSS viewport), scaled to `width`.
 * The screen content is the live buyer UI, not a picture of it. `dark`: status bar in white (green completion screen).
 */
const PhoneFrame = forwardRef(function PhoneFrame({ width = 300, dark = false, statusBg = '#ffffff', children, label, className = '', inert = false }, scrollRef) {
  const scale = width / (SCREEN_W + 24);
  return (
    <div
      className={`relative shrink-0 ${className}`}
      style={{ width, height: (SCREEN_H + 24) * scale }}
      role={label ? 'group' : undefined}
      aria-label={label}
    >
      <div
        className="absolute left-0 top-0 origin-top-left rounded-[58px] bg-[#0b0d12] p-3 shadow-[0_40px_80px_-30px_rgba(15,23,42,0.55),0_0_0_1.5px_rgba(255,255,255,0.08)_inset]"
        style={{ width: SCREEN_W + 24, height: SCREEN_H + 24, transform: `scale(${scale})` }}
      >
        <div className="relative h-full w-full overflow-hidden rounded-[46px] transition-colors duration-300" style={{ background: statusBg }} inert={inert || undefined}>
          {/* status bar */}
          <div className={`pointer-events-none absolute inset-x-0 top-0 z-30 flex h-[50px] items-center justify-between px-8 pt-1 text-[15px] font-semibold ${dark ? 'text-white' : 'text-slate-900'}`}>
            <span>9:41</span>
            <span className="flex items-center gap-1.5" aria-hidden="true">
              <svg width="18" height="11" viewBox="0 0 18 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="1" /><rect x="5" y="5" width="3" height="6" rx="1" /><rect x="10" y="2.5" width="3" height="8.5" rx="1" /><rect x="15" y="0" width="3" height="11" rx="1" /></svg>
              <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor"><path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.2-1.3A10.5 10.5 0 0 0 8 .4 10.5 10.5 0 0 0 .8 3.3L2 4.6a8.6 8.6 0 0 1 6-2.4Zm0 3.6c1.3 0 2.5.5 3.4 1.3l1.2-1.3A6.7 6.7 0 0 0 8 4a6.7 6.7 0 0 0-4.6 1.8l1.2 1.3c.9-.8 2.1-1.3 3.4-1.3Zm0 3.6c.5 0 .9.2 1.2.5L8 11 6.8 9.9c.3-.3.7-.5 1.2-.5Z" /></svg>
              <svg width="26" height="12" viewBox="0 0 26 12" fill="none"><rect x="0.5" y="0.5" width="22" height="11" rx="3.5" stroke="currentColor" opacity="0.4" /><rect x="2" y="2" width="19" height="8" rx="2" fill="currentColor" /><rect x="24" y="4" width="1.5" height="4" rx="0.75" fill="currentColor" opacity="0.4" /></svg>
            </span>
          </div>
          {/* dynamic island */}
          <div className="pointer-events-none absolute left-1/2 top-[11px] z-30 h-[34px] w-[122px] -translate-x-1/2 rounded-full bg-black" />
          <div ref={scrollRef} className="absolute inset-0 overflow-y-auto overscroll-contain pt-[50px] [scrollbar-width:none]" data-phone-screen>
            {children}
          </div>
          {/* home indicator */}
          <div className={`pointer-events-none absolute bottom-2 left-1/2 z-30 h-[5px] w-[134px] -translate-x-1/2 rounded-full ${dark ? 'bg-white/80' : 'bg-slate-900/80'}`} />
        </div>
      </div>
    </div>
  );
});

export default PhoneFrame;
