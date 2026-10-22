'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRequireAgent } from '../../hooks/useRequireAgent';
import { authFetch } from '../../utils/authFetch';
import { db } from '../../firebase/clientApp';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import PropertyPageClient from '../../components/PropertyPageClient';
import ImagePositioner from '../../components/ImagePositioner';
import { getCroppedImageBlob, blobToFile } from '../../utils/imageCrop';
import { Upload, Loader2, CheckCircle2, AlertCircle, RotateCcw } from 'lucide-react';

/**
 * Agency Branding setup + live preview.
 *
 * Shared default + personal override model (no approvals, no roles):
 *   - If this agent has no shared brand yet, saving here ESTABLISHES
 *     one for their agency name (createBrand) — every future agent
 *     with the exact same name inherits it automatically, no action
 *     from anyone.
 *   - If this agent already has a shared brand (inherited automatically
 *     on an exact name match, or because they established it
 *     themselves), saving here is always a PERSONAL override only —
 *     it never touches the shared brand or any other agent's page.
 *     "Reset to Agency Branding" clears it, falling back to the
 *     shared default.
 * The server (not this page) decides which of the two applies, based
 * on whether the agent already has a brand linked — see
 * /api/branding/confirm.
 *
 * Nothing here writes anything until the agent explicitly clicks
 * "Save" — uploading a logo and seeing suggested colours is entirely a
 * preview. The preview renders the exact same PropertyPageClient
 * component real buyers see (via previewBrand / previewPropertyId), so
 * there is no separate mockup that could drift out of sync with the
 * real page.
 */
export default function BrandingPage() {
  useRequireAgent();
  const { user } = useAuth();

  const [loadingMine, setLoadingMine] = useState(true);
  const [sharedBrand, setSharedBrand] = useState(null);
  const [personalOverride, setPersonalOverride] = useState({ logoUrl: null, colors: null });

  const [agencyName, setAgencyName] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState(null);
  const [uploadedLogoUrl, setUploadedLogoUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractionMessage, setExtractionMessage] = useState('');
  // Positioning is a separate, optional step after the initial upload +
  // colour extraction — deliberately never runs before extraction, since
  // baking a padded/positioned version first would feed the colour
  // picker a canvas full of background-fill padding instead of the
  // logo's own true colours.
  const [showLogoPositioner, setShowLogoPositioner] = useState(false);
  const [positioningLogo, setPositioningLogo] = useState(false);

  const [primary, setPrimary] = useState('#e48900');
  const [secondary, setSecondary] = useState('');

  const [previewProperty, setPreviewProperty] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(true);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);

  const loadMine = useCallback(async () => {
    if (!user) return;
    setLoadingMine(true);
    try {
      const res = await authFetch('/api/branding/mine');
      if (res.ok) {
        const data = await res.json();
        setSharedBrand(data.brand);
        setPersonalOverride(data.personalOverride || { logoUrl: null, colors: null });

        // Pre-fill the editor from whatever is currently EFFECTIVE —
        // the agent's own override if they have one, else the shared
        // default they're about to personalize/inherit from.
        const effectiveColors = data.personalOverride?.colors || data.brand?.colors || null;
        const effectiveLogoUrl = data.personalOverride?.logoUrl || data.brand?.logoUrl || null;
        if (effectiveColors?.primary) {
          setPrimary(effectiveColors.primary);
          setSecondary(effectiveColors.secondary || '');
        }
        if (effectiveLogoUrl) {
          setUploadedLogoUrl(effectiveLogoUrl);
          setLogoPreviewUrl(effectiveLogoUrl);
        }
        if (data.brand?.name) {
          setAgencyName(data.brand.name);
        }
      }
    } catch (err) {
      console.error('Failed to load branding status:', err);
    } finally {
      setLoadingMine(false);
    }
  }, [user]);

  useEffect(() => { loadMine(); }, [loadMine]);

  // Load one of the agent's own properties to preview against — read-only,
  // and PropertyPageClient's own existing owner-check means this preview
  // never counts as a view or otherwise affects real campaign stats.
  useEffect(() => {
    if (!user) return;
    const fetchPreviewProperty = async () => {
      setPreviewLoading(true);
      try {
        const q = query(
          collection(db, 'properties'),
          where('userId', '==', user.uid),
          orderBy('createdAt', 'desc'),
          limit(1)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          setPreviewProperty({ id: snap.docs[0].id, ...snap.docs[0].data() });
        }
      } catch (err) {
        console.error('Failed to load a property to preview against:', err);
      } finally {
        setPreviewLoading(false);
      }
    };
    fetchPreviewProperty();
  }, [user]);

  const handleLogoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    setLogoPreviewUrl(URL.createObjectURL(file));
    setExtractionMessage('');
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const uploadRes = await authFetch('/api/upload-image', { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error('Upload failed');
      const { url } = await uploadRes.json();
      setUploadedLogoUrl(url);

      setExtracting(true);
      const extractRes = await authFetch('/api/branding/extract-colors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logoUrl: url }),
      });
      const extractData = await extractRes.json();
      if (extractRes.ok && extractData.usable) {
        setPrimary(extractData.primary.hex);
        setSecondary(extractData.secondary?.hex || '');
      } else {
        setExtractionMessage(extractData.message || 'Couldn\'t confidently pick colours — choose them manually below.');
      }
    } catch (err) {
      console.error('Logo upload/extraction failed:', err);
      setExtractionMessage('Something went wrong analysing this logo — you can still pick colours manually.');
    } finally {
      setUploading(false);
      setExtracting(false);
    }
  };

  // Bakes the positioned crop and re-uploads it via the same
  // /api/upload-image endpoint already used above — uploadedLogoUrl is
  // then swapped to this new URL, which is what both the live preview
  // (proposedBrand.logoUrl) and the final "Save" action already read,
  // so nothing else needs to change for the new framing to take effect
  // everywhere it's used.
  const handleLogoPositionerSave = async ({ croppedAreaPixels }) => {
    setPositioningLogo(true);
    try {
      const blob = await getCroppedImageBlob(logoPreviewUrl || uploadedLogoUrl, croppedAreaPixels, {
        outputWidth: 1200,
        outputHeight: 400,
        background: '#ffffff',
      });
      const file = blobToFile(blob, 'logo.png');
      const formData = new FormData();
      formData.append('file', file);
      const uploadRes = await authFetch('/api/upload-image', { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error('Upload failed');
      const { url } = await uploadRes.json();
      setUploadedLogoUrl(url);
      setLogoPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      console.error('Logo positioning failed:', err);
      setExtractionMessage('Could not save that positioning — please try again.');
    } finally {
      setPositioningLogo(false);
      setShowLogoPositioner(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const res = await authFetch('/api/branding/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agencyName.trim() || undefined,
          logoUrl: uploadedLogoUrl,
          primary,
          secondary: secondary || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save branding');
      setSaved(true);
      await loadMine();
    } catch (err) {
      setSaveError(err.message || 'Failed to save branding. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    setSaveError('');
    try {
      const res = await authFetch('/api/branding/reset', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to reset branding');
      setSaved(false);
      await loadMine();
    } catch (err) {
      setSaveError(err.message || 'Failed to reset branding. Please try again.');
    } finally {
      setResetting(false);
    }
  };

  const hasPersonalOverride = !!(personalOverride.logoUrl || personalOverride.colors);
  const isEstablishing = !sharedBrand; // no shared brand yet — this save will ESTABLISH one, not override

  const proposedBrand = primary
    ? {
        logoUrl: uploadedLogoUrl || logoPreviewUrl,
        colors: {
          primary,
          primaryDark: primary,
          secondary: secondary || undefined,
          primaryText: '#ffffff',
        },
      }
    : null;

  if (loadingMine) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Agency Branding</h1>
          <p className="text-sm text-slate-500 mt-1">
            Give your public Premarket campaigns your own agency look — logo and colours, applied automatically.
          </p>
        </div>

        {sharedBrand && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <p className="text-sm text-emerald-800">
              {hasPersonalOverride ? (
                <>Your campaigns use a <strong>personal look</strong> you set yourself — <strong>{sharedBrand.name}</strong> is your agency's shared default underneath it.</>
              ) : (
                <>Your campaigns are currently branded as <strong>{sharedBrand.name}</strong> — automatically applied for every agent at this agency.</>
              )}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Setup form */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            {isEstablishing ? (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Agency / Office Name</label>
                <input
                  type="text"
                  value={agencyName}
                  onChange={(e) => setAgencyName(e.target.value)}
                  placeholder="e.g. Harcourts Property Hub"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Every agent who later signs up with this exact agency name automatically inherits what you set up here.
                </p>
              </div>
            ) : (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <p className="text-sm font-semibold text-slate-700">{sharedBrand.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Changes below only affect your own campaigns — your teammates still see {sharedBrand.name}'s shared look unless they set their own override too.
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                {isEstablishing ? 'Agency / Office Logo' : 'Your Personal Logo'}
              </label>
              <label className="flex items-center gap-3 px-4 py-3 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-orange-400 transition-colors">
                <Upload className="w-5 h-5 text-slate-400" />
                <span className="text-sm text-slate-500">
                  {logoFile ? logoFile.name : 'Click to upload a logo'}
                </span>
                <input type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
              </label>
              {(uploading || extracting) && (
                <p className="text-xs text-slate-400 mt-2 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {uploading ? 'Uploading logo...' : 'Analysing colours...'}
                </p>
              )}
              {extractionMessage && (
                <p className="text-xs text-amber-600 mt-2 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {extractionMessage}
                </p>
              )}
              {uploadedLogoUrl && !uploading && (
                <button
                  type="button"
                  onClick={() => setShowLogoPositioner(true)}
                  className="text-xs font-semibold text-orange-600 hover:text-orange-700 mt-2"
                >
                  Adjust logo positioning
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Primary Colour</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="w-10 h-10 rounded-lg border border-slate-200" />
                  <input type="text" value={primary} onChange={(e) => setPrimary(e.target.value)} className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono text-slate-900 placeholder:text-slate-400" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Secondary / Accent</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={secondary || '#ffffff'} onChange={(e) => setSecondary(e.target.value)} className="w-10 h-10 rounded-lg border border-slate-200" />
                  <input type="text" value={secondary} onChange={(e) => setSecondary(e.target.value)} placeholder="optional" className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono text-slate-900 placeholder:text-slate-400" />
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-400">
              This is only a preview. Nothing changes on your live campaigns until you save below.
            </p>

            {saveError && <p className="text-sm text-red-600">{saveError}</p>}
            {saved && <p className="text-sm text-emerald-600 font-semibold">Branding saved and applied to your campaigns.</p>}

            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={saving || resetting || (isEstablishing && !agencyName.trim()) || !primary}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-bold disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              {!isEstablishing && hasPersonalOverride && (
                <button
                  onClick={handleReset}
                  disabled={saving || resetting}
                  title="Remove your personal logo/colour override and go back to the shared agency default"
                  className="flex items-center gap-1.5 px-4 py-3 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 disabled:opacity-50"
                >
                  <RotateCcw className="w-4 h-4" />
                  {resetting ? 'Resetting...' : 'Reset to Agency Branding'}
                </button>
              )}
            </div>
          </div>

          {/* Live preview — the exact PropertyPageClient real buyers see */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-700">Live preview — exactly what buyers will see</p>
            </div>
            <div className="h-[720px] overflow-y-auto">
              {previewLoading ? (
                <div className="h-full flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-4 border-orange-500" />
                </div>
              ) : previewProperty ? (
                <PropertyPageClient previewPropertyId={previewProperty.id} previewBrand={proposedBrand} />
              ) : (
                <div className="h-full flex items-center justify-center text-center px-6">
                  <p className="text-sm text-slate-400">Add a property first to see a live branded preview here.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showLogoPositioner && (
        <ImagePositioner
          imageSrc={logoPreviewUrl || uploadedLogoUrl}
          aspect={3}
          cropShape="rect"
          title="Position your logo"
          description="Zoom out to leave room around your logo — any empty space is filled in white."
          onCancel={() => setShowLogoPositioner(false)}
          onSave={handleLogoPositionerSave}
          saving={positioningLogo}
        />
      )}
    </div>
  );
}
