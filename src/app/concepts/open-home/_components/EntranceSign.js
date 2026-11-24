'use client';

import { forwardRef } from 'react';
import { ScanLine, Footprints, Lock } from 'lucide-react';
import QrCode from '../../../components/QrCode';
import BrandLockup from './BrandLockup';

/**
 * The entrance QR sign for one open-home session. Every size is in `em`, and 1em is 1% of the sign's width, so the
 * same design renders exactly in a scaled on-screen preview, full screen on an iPad and at physical print size.
 *
 * Formats: A4 / A3 portrait (same proportions), a freestanding A-frame poster (600 x 900 mm) and an iPad screen
 * (landscape). Themes: 'dark' (office navy, or Premarket charcoal) and 'light' (white, saves ink on office printers).
 */
export const SIGN_FORMATS = {
  a4: { label: 'A4', detail: '210 × 297 mm', mm: [210, 297], orientation: 'portrait' },
  a3: { label: 'A3', detail: '297 × 420 mm', mm: [297, 420], orientation: 'portrait' },
  aframe: { label: 'A-frame', detail: '600 × 900 mm', mm: [600, 900], orientation: 'portrait' },
  ipad: { label: 'iPad screen', detail: 'Landscape', mm: [297, 210], orientation: 'landscape' },
};

function palette(partner, theme) {
  const dark = theme !== 'light';
  if (partner) {
    return dark
      ? { bg: `linear-gradient(160deg, ${partner.navy} 0%, #00122d 100%)`, text: '#ffffff', muted: 'rgba(255,255,255,0.78)', accent: partner.blue, line: 'rgba(255,255,255,0.16)', tone: 'dark' }
      : { bg: '#ffffff', text: partner.navy, muted: '#475569', accent: '#0284c7', line: '#e2e8f0', tone: 'light' };
  }
  return dark
    ? { bg: 'linear-gradient(160deg, #23262e 0%, #121419 100%)', text: '#ffffff', muted: 'rgba(255,255,255,0.78)', accent: '#e48900', line: 'rgba(255,255,255,0.16)', tone: 'dark' }
    : { bg: '#ffffff', text: '#1f2329', muted: '#475569', accent: '#c2410c', line: '#e2e8f0', tone: 'light' };
}

const SERIF = { fontFamily: 'var(--font-playfair, Georgia, serif)' };

// `size`: a width (em); or fill: as tall as the space it's given (up to `max`), keeping it square.
function QrCard({ url, size, fill = false, max = '50em' }) {
  const bracket = (pos) => {
    const base = { position: 'absolute', width: '22%', height: '22%', borderColor: '#10b981', borderStyle: 'solid', borderWidth: 0 };
    const t = '0.9em';
    const r = '2.2em';
    const map = {
      tl: { top: '-1.6em', left: '-1.6em', borderTopWidth: t, borderLeftWidth: t, borderTopLeftRadius: r },
      tr: { top: '-1.6em', right: '-1.6em', borderTopWidth: t, borderRightWidth: t, borderTopRightRadius: r },
      bl: { bottom: '-1.6em', left: '-1.6em', borderBottomWidth: t, borderLeftWidth: t, borderBottomLeftRadius: r },
      br: { bottom: '-1.6em', right: '-1.6em', borderBottomWidth: t, borderRightWidth: t, borderBottomRightRadius: r },
    };
    return <span aria-hidden="true" style={{ ...base, ...map[pos] }} />;
  };
  const outer = fill ? { height: '100%', maxHeight: max, aspectRatio: '1 / 1' } : { width: size, aspectRatio: '1 / 1' };
  return (
    <div className="relative" style={outer}>
      {bracket('tl')}{bracket('tr')}{bracket('bl')}{bracket('br')}
      {/* The QR's own 2-module margin plus the card's padding keep the standard 4-module quiet zone. */}
      <div className="h-full w-full bg-white" style={{ borderRadius: '3.2em', padding: '1.4em', boxShadow: '0 1.6em 4em -1.6em rgba(0,0,0,0.45)' }}>
        <QrCode value={url} ecc="Q" border={2} color="#0b1220" className="block h-full w-full" title="Scan to check in" />
      </div>
    </div>
  );
}

function Steps({ c, compact }) {
  const steps = [
    { Icon: ScanLine, title: 'Scan & check in', body: 'No app or account' },
    { Icon: Footprints, title: 'Inspect', body: 'Take your time' },
    { Icon: Lock, title: 'Share your opinion', body: 'Anonymously' },
  ];
  return (
    <div className="grid grid-cols-3" style={{ gap: compact ? '2.2em' : '3em' }}>
      {steps.map(({ Icon, title, body }, i) => (
        <div key={title} className="text-center">
          <div className="mx-auto grid place-items-center rounded-full" style={{ width: compact ? '7.4em' : '9.5em', height: compact ? '7.4em' : '9.5em', background: c.tone === 'dark' ? 'rgba(255,255,255,0.1)' : '#f1f5f9', border: `0.25em solid ${c.line}` }}>
            <Icon style={{ width: '45%', height: '45%', color: c.accent }} strokeWidth={2} aria-hidden="true" />
          </div>
          <p className="font-semibold" style={{ marginTop: '1.3em', fontSize: compact ? '2.5em' : '3.1em', color: c.text }}>
            <span style={{ color: c.accent }}>{i + 1}.</span> {title}
          </p>
          <p style={{ marginTop: '0.3em', fontSize: compact ? '2em' : '2.5em', color: c.muted }}>{body}</p>
        </div>
      ))}
    </div>
  );
}

const EntranceSign = forwardRef(function EntranceSign(
  { property, partner, url, format = 'a4', theme = 'dark', showAddress = true, width = '600px', className = '', style },
  ref,
) {
  const f = SIGN_FORMATS[format] || SIGN_FORMATS.a4;
  const c = palette(partner, theme);
  const [w, h] = f.mm;
  const base = {
    width,
    aspectRatio: `${w} / ${h}`,
    fontSize: `calc(${width} / 100)`,
    background: c.bg,
    color: c.text,
    WebkitPrintColorAdjust: 'exact',
    printColorAdjust: 'exact',
    ...style,
  };
  const address = `${property.street}, ${property.suburb}`;
  const footer = (
    <p style={{ fontSize: '2.4em', color: c.muted }}>
      Price opinions are anonymous and never linked to your check-in. Can&rsquo;t scan? Ask {property.agentName} to check you in.
    </p>
  );
  const bar = <div aria-hidden="true" className="absolute inset-x-0 bottom-0" style={{ height: '1.6em', background: `linear-gradient(90deg, #10b981, ${c.accent})` }} />;

  if (f.orientation === 'landscape') {
    return (
      <div ref={ref} className={`relative flex overflow-hidden ${className}`} style={{ ...base, lineHeight: 1.25 }} data-sign-format={format}>
        <div className="flex min-w-0 flex-1 flex-col" style={{ padding: '5em 2em 5em 5.5em' }}>
          <BrandLockup partner={partner} tone={c.tone} height="3.2em" gap="1.5em" />
          <div className="flex flex-1 flex-col justify-center">
            <p className="font-semibold uppercase" style={{ fontSize: '2.2em', letterSpacing: '0.25em', color: c.accent }}>Welcome to the</p>
            <h1 className="whitespace-nowrap font-semibold" style={{ ...SERIF, fontSize: '8.6em', lineHeight: 1, letterSpacing: '-0.02em' }}>Open Home</h1>
            {showAddress && <p style={{ marginTop: '0.5em', fontSize: '2.7em', color: c.muted }}>{address}</p>}
            <p className="font-bold" style={{ marginTop: '0.9em', fontSize: '4.8em', letterSpacing: '-0.01em' }}>Scan to check in.</p>
            <p style={{ marginTop: '0.3em', fontSize: '2.6em', color: c.muted }}>Inspect. Share your opinion. You&rsquo;re done.</p>
          </div>
          <p style={{ fontSize: '1.9em', color: c.muted }}>
            No app or account needed. Price opinions are anonymous. Can&rsquo;t scan? Ask {property.agentName} to check you in.
          </p>
        </div>
        <div className="flex flex-col items-center justify-center" style={{ width: '43%', padding: '5em 5.5em 5em 1em' }}>
          <QrCard url={url} size="35em" />
          <p className="text-center font-semibold" style={{ marginTop: '1.8em', fontSize: '2.4em', color: c.text }}>Point your phone camera here</p>
        </div>
        {bar}
      </div>
    );
  }

  return (
    <div ref={ref} className={`relative flex flex-col overflow-hidden ${className}`} style={{ ...base, lineHeight: 1.3 }} data-sign-format={format}>
      <div style={{ padding: '6em 7em 0' }}>
        <BrandLockup partner={partner} tone={c.tone} height="4em" gap="1.8em" />
      </div>
      <div style={{ padding: '4.5em 7em 0' }}>
        <p className="font-semibold uppercase" style={{ fontSize: '3em', letterSpacing: '0.25em', color: c.accent }}>Welcome to the</p>
        <h1 className="font-semibold" style={{ ...SERIF, fontSize: '12.5em', lineHeight: 1, letterSpacing: '-0.02em' }}>Open Home</h1>
        {showAddress && <p style={{ marginTop: '0.7em', fontSize: '3.5em', color: c.muted }}>{address}</p>}
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center" style={{ padding: '4em 0' }}>
        <QrCard url={url} fill max="64em" />
      </div>
      <div className="text-center" style={{ padding: '0 7em' }}>
        <p className="font-bold" style={{ fontSize: '7.4em', letterSpacing: '-0.015em', lineHeight: 1 }}>Scan to check in.</p>
        <p style={{ marginTop: '0.5em', fontSize: '3.8em', color: c.muted }}>Inspect. Share your opinion. You&rsquo;re done.</p>
      </div>
      <div style={{ padding: '4.5em 7em 0' }}><Steps c={c} compact /></div>
      <div className="text-center" style={{ padding: '3.4em 4em 4.8em', borderTop: `0.2em solid ${c.line}`, margin: '4em 7em 0' }}>{footer}</div>
      {bar}
    </div>
  );
});

export default EntranceSign;
