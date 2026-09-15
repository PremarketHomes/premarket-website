'use client';

import { useState, useCallback } from 'react';
import Image from 'next/image';
import { shouldContainImage } from '../../utils/imageFit';

/**
 * Drop-in replacement for next/image's `fill` mode used across the
 * property page's photo frames (hero, gallery thumbnails). Renders with
 * `object-cover` by default — identical to before, zero visual change
 * for every normal landscape real-estate photo. Once the image has
 * loaded and its real dimensions are known, if `object-cover` would
 * destructively crop it (see utils/imageFit.js), switches that one image
 * to `object-contain` over a black backdrop that fills the rest of the
 * frame — the frame's own size/position never changes, only how this
 * one image fits inside it. The source image itself is never modified.
 *
 * Must be used inside a `position: relative` container with a defined
 * size/aspect-ratio, same as next/image's `fill` mode.
 */
export default function SmartPropertyImage({ src, alt, priority, className = '', sizes }) {
  const [contain, setContain] = useState(false);

  const handleLoad = useCallback((e) => {
    const img = e.target;
    if (shouldContainImage(img.naturalWidth, img.naturalHeight)) {
      setContain(true);
    }
  }, []);

  return (
    <>
      {contain && <div className="absolute inset-0 bg-black" aria-hidden="true" />}
      <Image
        src={src}
        alt={alt}
        fill
        unoptimized
        priority={priority}
        sizes={sizes}
        draggable={false}
        onLoad={handleLoad}
        className={`select-none ${contain ? 'object-contain' : 'object-cover'} ${className}`}
      />
    </>
  );
}
