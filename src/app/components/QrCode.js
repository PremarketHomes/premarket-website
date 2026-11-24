'use client';

import { useMemo } from 'react';
import { encodeQr, qrSvgPath } from '../utils/qrCode';

/**
 * A QR code drawn by Premarket itself (utils/qrCode.js) as a resolution-independent SVG: sharp on screen, an iPad and an
 * A3 or A-frame print. The encoded link never leaves the browser. `ecc` 'Q' tolerates ~25% damage (printed signs).
 */
export default function QrCode({ value, ecc = 'M', border = 4, color = '#0f172a', background = '#ffffff', className, title = 'QR code' }) {
  const { path, n } = useMemo(() => {
    const qr = encodeQr(value, { ecc });
    return { path: qrSvgPath(qr, border), n: qr.size + border * 2 };
  }, [value, ecc, border]);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={title}
      className={className}
      data-qr-value={value}
    >
      <rect width={n} height={n} fill={background} />
      <path d={path} fill={color} />
    </svg>
  );
}
