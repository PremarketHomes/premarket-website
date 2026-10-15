'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import { useRequireAgent } from '../../hooks/useRequireAgent';
import { authFetch } from '../../utils/authFetch';
import { db } from '../../firebase/clientApp';
import { doc, updateDoc } from 'firebase/firestore';
import Link from 'next/link';
import {
  ArrowLeft,
  User,
  Camera,
  Save,
  KeyRound,
  Check,
  Loader2,
  Building2,
  MessageSquare,
} from 'lucide-react';
import ImagePositioner from '../../components/ImagePositioner';
import { getCroppedImageBlob, blobToFile } from '../../utils/imageCrop';

const TEAM_SMS_NUMBER = process.env.NEXT_PUBLIC_TWILIO_PHONE_NUMBER || '+61 491 570 006';

const ROLES = [
  { id: 'homeowner', label: 'Home Owner / Investor' },
  { id: 'buyer', label: 'Buyer' },
  { id: 'developer', label: 'Developer' },
  { id: 'agent', label: 'Agent' },
];

export default function SettingsPage() {
  useRequireAgent();
  const { user, userData, setUserData, loading } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef(null);
  const logoInputRef = useRef(null);

  const [firstName, setFirstName] = useState(userData?.firstName || '');
  const [lastName, setLastName] = useState(userData?.lastName || '');
  const [email, setEmail] = useState(userData?.email || user?.email || '');
  const [roles, setRoles] = useState(userData?.roles || []);
  const [avatarPreview, setAvatarPreview] = useState(userData?.avatar || '');
  const [avatarFile, setAvatarFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(userData?.logoUrl || '');
  const [logoFile, setLogoFile] = useState(null);
  const [companyName, setCompanyName] = useState(userData?.companyName || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetSending, setResetSending] = useState(false);

  // ImagePositioner state — shared between the avatar and logo pickers.
  // `positionerTarget` is which field the in-progress crop is for; the
  // raw, just-selected file never touches avatarFile/logoFile directly
  // any more — it's held here only long enough to be baked into a
  // positioned File by the positioner's own Save step.
  const [positionerTarget, setPositionerTarget] = useState(null);
  const [positionerImageSrc, setPositionerImageSrc] = useState(null);
  const [positionerSaving, setPositionerSaving] = useState(false);
  const [positionerError, setPositionerError] = useState('');

  // SMS enrollment state
  const [smsPhone, setSmsPhone] = useState(userData?.smsPhone || '');
  const [smsEnabled, setSmsEnabled] = useState(!!userData?.smsEnabled);
  const [smsSaving, setSmsSaving] = useState(false);
  const [smsSaved, setSmsSaved] = useState(false);
  const [smsError, setSmsError] = useState('');

  // Sync state when userData loads after initial render — userData comes
  // from AuthContext's own async Firestore read, which is almost always
  // still null on first render, so this has to be a real effect. (It was
  // previously written as `useState(fn, [userData])`, which looks like an
  // effect but isn't one: useState's lazy initializer runs exactly once,
  // on mount, and silently ignores any second argument — so userData
  // loading in afterwards never actually synced, and the avatar/logo/name
  // shown here could permanently disagree with what's actually saved.)
  useEffect(() => {
    if (userData) {
      setFirstName(userData.firstName || '');
      setLastName(userData.lastName || '');
      setEmail(userData.email || user?.email || '');
      setRoles(userData.roles || []);
      setAvatarPreview(userData.avatar || '');
      setLogoPreview(userData.logoUrl || '');
      setCompanyName(userData.companyName || '');
    }
  }, [userData, user?.email]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    );
  }

  if (!user) {
    router.push('/join');
    return null;
  }

  // Both pickers open the positioner on the freshly-selected file rather
  // than setting avatarFile/logoFile directly — the file that actually
  // gets uploaded is whatever the positioner's Save step bakes, not the
  // raw original. Resetting e.target.value lets the same file be picked
  // again (e.g. after Cancel) without the browser treating it as "no
  // change" and skipping onChange.
  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPositionerError('');
    setPositionerImageSrc(URL.createObjectURL(file));
    setPositionerTarget('avatar');
  };

  const handleLogoChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPositionerError('');
    setPositionerImageSrc(URL.createObjectURL(file));
    setPositionerTarget('logo');
  };

  // Reopens the positioner on the CURRENT saved avatar/logo (a remote
  // CDN url, not a freshly-picked file) so an agent can adjust an
  // already-saved image's framing without re-selecting the original
  // file — satisfies "reopening the editor shows the saved image and
  // positioning" for the common case of just wanting to nudge the crop.
  // BunnyCDN's pull zone sends Access-Control-Allow-Origin: * on every
  // response, so loading a remote avatar/logo url into the canvas this
  // bakes from (getCroppedImageBlob) never taints it — confirmed this
  // isn't a repeat of the original CORS-shaped failure class before
  // relying on it here.
  const openRepositioner = (target, src) => {
    if (!src) return;
    setPositionerError('');
    setPositionerImageSrc(src);
    setPositionerTarget(target);
  };

  const closePositioner = () => {
    // Only ever revokes a URL this component itself created (a blob:
    // url from a freshly-picked file) — revoking a plain https: url
    // (the reposition-existing-image path) is a documented no-op, but
    // tracked explicitly anyway so intent here is unambiguous.
    if (positionerImageSrc?.startsWith('blob:')) URL.revokeObjectURL(positionerImageSrc);
    setPositionerImageSrc(null);
    setPositionerTarget(null);
    setPositionerError('');
  };

  const handlePositionerSave = async ({ croppedAreaPixels }) => {
    setPositionerSaving(true);
    setPositionerError('');
    try {
      if (positionerTarget === 'avatar') {
        const blob = await getCroppedImageBlob(positionerImageSrc, croppedAreaPixels, {
          outputWidth: 480,
          outputHeight: 480,
        });
        const file = blobToFile(blob, 'avatar.png');
        setAvatarPreview(URL.createObjectURL(blob));
        setAvatarFile(file);
      } else if (positionerTarget === 'logo') {
        // Wide, padded frame — the agent positions/zooms so the whole
        // mark is visible with room around it; a white background fills
        // any space they leave, so a transparent-background logo still
        // looks finished rather than showing a checkerboard/void.
        const blob = await getCroppedImageBlob(positionerImageSrc, croppedAreaPixels, {
          outputWidth: 1200,
          outputHeight: 400,
          background: '#ffffff',
        });
        const file = blobToFile(blob, 'logo.png');
        setLogoPreview(URL.createObjectURL(blob));
        setLogoFile(file);
      }
      closePositioner();
    } catch (err) {
      console.error('Error positioning image:', err);
      // Deliberately does NOT close the positioner or lose the crop the
      // agent just made — closing here (the original behaviour) threw
      // away their positioning on a transient failure, forcing them to
      // redo it from scratch. They can retry Save or Cancel explicitly.
      setPositionerError('Could not process that image. You can try Save again, or Cancel and pick a different file.');
    } finally {
      setPositionerSaving(false);
    }
  };

  const toggleRole = (roleId) => {
    setRoles((prev) =>
      prev.includes(roleId)
        ? prev.filter((r) => r !== roleId)
        : [...prev, roleId]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError('');
    try {
      let avatarUrl = userData?.avatar || '';

      // Upload avatar if changed. Previously, a failed upload here
      // (res.ok === false) was silently ignored — avatarUrl quietly
      // fell back to the old value, but the rest of this function kept
      // going and still reported "Saved" at the end. The agent would
      // see their careful crop vanish on the next refresh with no
      // indication anything had gone wrong. Now a failed upload throws,
      // which aborts the whole save (nothing partially persists) and
      // surfaces a specific, honest error instead of a false "Saved".
      if (avatarFile) {
        setUploadingAvatar(true);
        const formData = new FormData();
        formData.append('file', avatarFile);
        const res = await authFetch('/api/upload-image', {
          method: 'POST',
          body: formData,
        });
        setUploadingAvatar(false);
        if (!res.ok) {
          throw new Error('Your new profile photo could not be uploaded. Your previous photo is unchanged — please try again.');
        }
        const data = await res.json();
        avatarUrl = data.url;
      }

      let logoUrl = userData?.logoUrl || '';

      // Upload logo if changed — same failure handling as the avatar.
      if (logoFile) {
        const logoFormData = new FormData();
        logoFormData.append('file', logoFile);
        const logoRes = await authFetch('/api/upload-image', {
          method: 'POST',
          body: logoFormData,
        });
        if (!logoRes.ok) {
          throw new Error('Your new agency logo could not be uploaded. Your previous logo is unchanged — please try again.');
        }
        const logoData = await logoRes.json();
        logoUrl = logoData.url;
      }

      const updates = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        roles,
        avatar: avatarUrl,
        ...(logoUrl && { logoUrl }),
        companyName: companyName.trim(),
      };

      await updateDoc(doc(db, 'users', user.uid), updates);
      setUserData((prev) => ({ ...prev, ...updates }));
      setAvatarFile(null);
      setLogoFile(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Error saving profile:', err);
      // avatarFile/logoFile are deliberately left set (not cleared) on
      // failure — the baked crop the agent already made is still ready
      // to go, so retrying Save re-uploads it without making them
      // reopen the positioner and redo the crop from scratch.
      setSaveError(err.message || 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
      setUploadingAvatar(false);
    }
  };

  const handleSmsSave = async () => {
    setSmsSaving(true);
    setSmsSaved(false);
    setSmsError('');
    try {
      const res = await authFetch('/api/users/sms-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smsPhone: smsPhone.trim() || null,
          smsEnabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save SMS settings');
      }
      setSmsPhone(data.smsPhone || '');
      setUserData((prev) => ({
        ...prev,
        smsPhone: data.smsPhone || null,
        smsEnabled: data.smsEnabled,
      }));
      setSmsSaved(true);
      setTimeout(() => setSmsSaved(false), 3000);
    } catch (err) {
      console.error('Error saving SMS settings:', err);
      setSmsError(err.message || 'Failed to save SMS settings');
    } finally {
      setSmsSaving(false);
    }
  };

  const handlePasswordReset = async () => {
    setResetSending(true);
    try {
      const res = await authFetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      });
      if (!res.ok) throw new Error('Request failed');
      setResetSent(true);
      setTimeout(() => setResetSent(false), 5000);
    } catch (err) {
      console.error('Error sending reset email:', err);
      alert('Failed to send reset email.');
    } finally {
      setResetSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link href="/dashboard" className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <h1 className="text-base font-bold text-slate-900">Settings</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Avatar */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">Profile Photo</h2>
          <div className="flex items-center gap-5">
            <div className="relative group">
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt=""
                  className="w-20 h-20 rounded-xl object-cover"
                />
              ) : (
                <div className="w-20 h-20 rounded-xl bg-orange-100 flex items-center justify-center">
                  <User className="w-8 h-8 text-orange-600" />
                </div>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-all cursor-pointer"
              >
                <Camera className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
              />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-sm font-semibold text-orange-600 hover:text-orange-700 transition-colors"
                >
                  Change photo
                </button>
                {avatarPreview && (
                  <button
                    onClick={() => openRepositioner('avatar', avatarPreview)}
                    className="text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                  >
                    Reposition
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">JPG, PNG. Max 5MB.</p>
            </div>
          </div>
        </div>

        {/* Agency Logo (agents only) */}
        {(userData?.isAgent || userData?.agent) && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">Agency Logo</h2>
            <div className="flex items-center gap-5">
              <div className="relative group">
                {logoPreview ? (
                  // w-32 (not w-20) with object-contain, not object-cover
                  // — the positioned logo is baked wide (3:1), so a
                  // forced square preview box here would crop its sides
                  // off and no longer be an accurate preview of the
                  // saved result.
                  <img
                    src={logoPreview}
                    alt="Agency logo"
                    className="w-32 h-20 rounded-xl object-contain bg-slate-50 border border-slate-100"
                  />
                ) : (
                  <div className="w-32 h-20 rounded-xl bg-slate-100 flex items-center justify-center">
                    <Building2 className="w-8 h-8 text-slate-400" />
                  </div>
                )}
                <button
                  onClick={() => logoInputRef.current?.click()}
                  className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-all cursor-pointer"
                >
                  <Camera className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleLogoChange}
                  className="hidden"
                />
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    className="text-sm font-semibold text-orange-600 hover:text-orange-700 transition-colors"
                  >
                    Change logo
                  </button>
                  {logoPreview && (
                    <button
                      onClick={() => openRepositioner('logo', logoPreview)}
                      className="text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                    >
                      Reposition
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1">Displayed on property listings, TV displays, and your agent profile.</p>
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Agency Title</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-all"
                placeholder="e.g. Ray White, LJ Hooker"
              />
            </div>
          </div>
        )}

        {/* Personal Info */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">Personal Information</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">First Name</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-all"
                placeholder="First name"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Last Name</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-all"
                placeholder="Last name"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              disabled
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-500 bg-slate-50 cursor-not-allowed"
            />
            <p className="text-xs text-slate-400 mt-1">Email cannot be changed from here.</p>
          </div>
        </div>

        {/* Roles */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">Roles</h2>
          <p className="text-xs text-slate-500 mb-4">Select all that apply to you.</p>
          <div className="grid grid-cols-2 gap-3">
            {ROLES.map((role) => {
              const isActive = roles.includes(role.id);
              return (
                <button
                  key={role.id}
                  onClick={() => toggleRole(role.id)}
                  className={`px-4 py-3 rounded-xl border text-sm font-medium text-left transition-all ${
                    isActive
                      ? 'border-orange-400 bg-orange-50 text-orange-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    {role.label}
                    {isActive && <Check className="w-4 h-4 text-orange-500" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Password */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">Password</h2>
          <p className="text-xs text-slate-500 mb-4">Reset your password via email.</p>
          <button
            onClick={handlePasswordReset}
            disabled={resetSending || resetSent}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              resetSent
                ? 'bg-green-50 text-green-600'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            } disabled:opacity-70`}
          >
            {resetSent ? (
              <>
                <Check className="w-4 h-4" />
                Reset email sent!
              </>
            ) : resetSending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <KeyRound className="w-4 h-4" />
                Send Password Reset Email
              </>
            )}
          </button>
        </div>

        {/* SMS */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare className="w-4 h-4 text-orange-600" />
            <h2 className="text-sm font-semibold text-slate-900">SMS Shortcuts</h2>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Text <span className="font-semibold text-slate-700">{TEAM_SMS_NUMBER}</span> from your mobile to add listings, request reports, or grab a public share link — no app or dashboard required.
          </p>

          <div className="space-y-3 mb-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Your Mobile Number</label>
              <input
                type="tel"
                value={smsPhone}
                onChange={(e) => setSmsPhone(e.target.value)}
                placeholder="+61412345678"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-all"
              />
              <p className="text-xs text-slate-400 mt-1">Used to identify you when texting our team SMS number. E.164 format.</p>
            </div>

            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={smsEnabled}
                onChange={(e) => setSmsEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
              />
              <span className="text-sm text-slate-700">Enable SMS shortcuts for this number</span>
            </label>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4">
            <p className="text-xs font-semibold text-slate-700 mb-1">Try texting:</p>
            <ul className="text-xs text-slate-600 space-y-0.5">
              <li>• A realestate.com.au URL to create a new listing</li>
              <li>• <span className="font-mono">report latest</span> for a summary + emailed PDF</li>
              <li>• <span className="font-mono">link 12 Pacific Ave</span> for the public share URL</li>
              <li>• <span className="font-mono">help</span> for the full command list</li>
            </ul>
          </div>

          {smsError && (
            <p className="text-xs text-red-600 mb-3">{smsError}</p>
          )}

          <button
            onClick={handleSmsSave}
            disabled={smsSaving}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              smsSaved ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            } disabled:opacity-70`}
          >
            {smsSaved ? (
              <>
                <Check className="w-4 h-4" />
                Saved
              </>
            ) : smsSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save SMS Settings
              </>
            )}
          </button>
        </div>

        {/* Save Button */}
        {saveError && (
          <p className="text-sm text-red-600 text-right">{saveError}</p>
        )}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all shadow-lg ${
              saved
                ? 'bg-green-500 text-white shadow-green-500/30'
                : 'bg-gradient-to-r from-[#e48900] to-[#c64500] text-white shadow-orange-500/30 hover:shadow-orange-500/50'
            } disabled:opacity-70`}
          >
            {saved ? (
              <>
                <Check className="w-4 h-4" />
                Saved
              </>
            ) : saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {uploadingAvatar ? 'Uploading photo...' : 'Saving...'}
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>

      {positionerTarget && (
        <ImagePositioner
          imageSrc={positionerImageSrc}
          aspect={positionerTarget === 'avatar' ? 1 : 3}
          cropShape={positionerTarget === 'avatar' ? 'round' : 'rect'}
          title={positionerTarget === 'avatar' ? 'Position your photo' : 'Position your logo'}
          description={
            positionerTarget === 'avatar'
              ? 'Drag to reposition. Use the slider, your scroll wheel, or pinch to zoom.'
              : 'Zoom out to leave room around your logo — any empty space is filled in white.'
          }
          onCancel={closePositioner}
          onSave={handlePositionerSave}
          saving={positionerSaving}
          error={positionerError}
        />
      )}
    </div>
  );
}
