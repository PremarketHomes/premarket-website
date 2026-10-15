'use client';

import { useCallback, useState } from 'react';
import Cropper from 'react-easy-crop';

/**
 * Reusable drag-to-reposition + zoom image control, built on
 * react-easy-crop (mouse, trackpad scroll, and touch pinch/drag are all
 * handled by the library itself — nothing device-specific to build here).
 * Used by:
 *   - dashboard/settings/page.js (profile avatar, cropShape="round")
 *   - dashboard/branding/page.js (agency logo, wide aspect, padded frame)
 *   - dashboard/add + edit property pages (hero photo focal point)
 *
 * What the caller does with the result differs per use case (bake a new
 * file via getCroppedImageBlob, vs. derive a plain CSS object-position
 * via cropAreaToObjectPosition — see imageCrop.js for both) — this
 * component only ever reports the crop, it never uploads or persists
 * anything itself.
 *
 * `minZoom` defaults to 1 and the cropper's own `objectFit="contain"`
 * guarantees the image always fully covers the crop frame at that
 * minimum — there is no zoom level at which this can show blank space
 * around the subject.
 *
 * Passing `minZoom === maxZoom` (e.g. the property hero's focal-point
 * picker, both locked to 1) hides the zoom slider and turns this into a
 * pure repositioning control — the image can only be panned, never
 * scaled, and the centre of the resulting crop rectangle is a clean 2D
 * focal point. That's deliberately a plain CSS `object-position`, not a
 * baked crop or a transform — see cropAreaToObjectPosition's own
 * comment in imageCrop.js for why a full zoom+pan transform isn't used
 * for property photos specifically.
 *
 * `error`, when set, renders a message above the action buttons — the
 * caller's own upload/processing failure, not anything this component
 * detects itself (it has no concept of a failed save).
 */
export default function ImagePositioner({
  imageSrc,
  aspect = 1,
  cropShape = 'rect',
  minZoom = 1,
  maxZoom = 3,
  title = 'Position your image',
  description = 'Drag to reposition. Use the slider, your scroll wheel, or pinch to zoom.',
  onCancel,
  onSave,
  saving = false,
  error = '',
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState(null);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);

  const handleCropComplete = useCallback((area, areaPixels) => {
    setCroppedArea(area);
    setCroppedAreaPixels(areaPixels);
  }, []);

  const handleReset = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  };

  const handleSave = () => {
    if (!croppedArea || !croppedAreaPixels) return;
    onSave({ croppedArea, croppedAreaPixels, zoom });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-1">{title}</h3>
        <p className="text-sm text-slate-500 mb-4">{description}</p>

        <div
          className="relative w-full bg-slate-100 rounded-xl overflow-hidden"
          style={{ aspectRatio: aspect, touchAction: 'none' }}
        >
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            cropShape={cropShape}
            minZoom={minZoom}
            maxZoom={maxZoom}
            objectFit="contain"
            restrictPosition
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={handleCropComplete}
          />
        </div>

        <div className="flex items-center gap-3 mt-4">
          {minZoom < maxZoom && (
            <>
              <span className="text-xs font-medium text-slate-500 shrink-0">Zoom</span>
              <input
                type="range"
                min={minZoom}
                max={maxZoom}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                aria-label="Zoom"
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-slate-200"
                style={{ accentColor: 'var(--brand-primary, #c2410c)' }}
              />
            </>
          )}
          <button
            type="button"
            onClick={handleReset}
            className={`text-xs font-semibold text-slate-500 hover:text-slate-800 shrink-0 ${minZoom === maxZoom ? 'ml-auto' : ''}`}
          >
            Reset
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-600 mt-3">{error}</p>
        )}

        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !croppedArea}
            className="flex-1 py-2.5 rounded-xl bg-[var(--brand-primary,#c2410c)] hover:opacity-90 text-white font-semibold transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
