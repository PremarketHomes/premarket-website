'use client';

import { useState } from 'react';
import Image from 'next/image';
import { isOptimizableImageUrl } from '../utils/imageHost';

/**
 * A property photo shown small (list rows and cards). It loads a copy resized to the displayed size by Next's image
 * optimizer instead of the full-size original (often 2000 px and several hundred KB). Only hosts the optimizer may
 * fetch are resized (see imageHost.js); any other host, or a resized copy that fails to load, shows the original
 * photo exactly as before. Editing screens and the full-screen viewer keep using the originals.
 *
 * Fixed size: pass width and height (the displayed CSS size; a 2x copy is used on sharp screens).
 * Fills its (positioned) parent: pass fill and sizes.
 */
export default function PropertyThumb({ src, alt = '', width, height, fill, sizes, className, style, onLoad, onError, loading = 'lazy' }) {
  const [failedSrc, setFailedSrc] = useState(null);
  const direct = !isOptimizableImageUrl(src) || failedSrc === src;
  return (
    <Image
      src={src}
      alt={alt}
      {...(fill ? { fill: true, sizes } : { width, height })}
      className={className}
      style={style}
      loading={loading}
      unoptimized={direct}
      onLoad={onLoad}
      onError={(e) => {
        if (!direct) setFailedSrc(src); // resized copy failed: fall back to the original
        else if (onError) onError(e);
      }}
    />
  );
}
