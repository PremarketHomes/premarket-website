'use client';

import { useState, useCallback } from 'react';
import Image from 'next/image';
import { shouldContainImage } from '../../utils/imageFit';
import { isOptimizableImageUrl } from '../../utils/imageHost';

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
 * `unoptimized` is now conditional, not hardcoded: Next's image
 * optimizer only works for the handful of hosts allow-listed in
 * next.config.mjs, and a freshly REX/Agentbox-synced photo can live
 * anywhere until the compression cron rehosts it — see
 * utils/imageHost.js. Optimizing (and therefore `sizes`-aware,
 * properly-compressed) loading only kicks in for a recognised host;
 * anything else falls back to the original always-unoptimized
 * behaviour, so no property's hero can break from this.
 *
 * Must be used inside a `position: relative` container with a defined
 * size/aspect-ratio, same as next/image's `fill` mode.
 *
 * `objectPosition` is optional and only meaningful while this is in
 * object-cover mode — once an image is too extreme an aspect ratio and
 * this switches to the letterboxed object-contain fallback above, the
 * whole image is already visible and a focal point has nothing left to
 * do, so it's intentionally not applied in that branch.
 */
export default function SmartPropertyImage({ src, alt, priority, className = '', sizes, objectPosition }) {
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
        unoptimized={!isOptimizableImageUrl(src)}
        priority={priority}
        sizes={sizes}
        draggable={false}
        onLoad={handleLoad}
        style={!contain && objectPosition ? { objectPosition } : undefined}
        className={`select-none ${contain ? 'object-contain' : 'object-cover'} ${className}`}
      />
    </>
  );
}
