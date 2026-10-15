'use client';

import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { db } from '../firebase/clientApp';
import { authFetch } from '../utils/authFetch';
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Camera, X, Loader2, User, MessageCircle } from 'lucide-react';
import { normalizeE164 } from '../utils/phone';
import ImagePositioner from './ImagePositioner';
import { getCroppedImageBlob, blobToFile } from '../utils/imageCrop';

export default function AgentModal({ show, onClose, onSave, agent = null, userId }) {
  const fileInputRef = useRef(null);
  const [name, setName] = useState(agent?.name || '');
  const [preview, setPreview] = useState(agent?.avatar || '');
  const [file, setFile] = useState(null);
  const [smsPhoneInput, setSmsPhoneInput] = useState(agent?.smsPhone || '');
  const [smsEnabled, setSmsEnabled] = useState(!!agent?.smsEnabled);
  const [phoneError, setPhoneError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Same positioner pattern as dashboard/settings/page.js's avatar field
  // — the raw picked file (or, for "Reposition", the already-saved
  // remote avatar url) is held here only long enough for the
  // positioner's Save step to bake it into a File, which becomes `file`.
  const [positionerImageSrc, setPositionerImageSrc] = useState(null);
  const [positionerSaving, setPositionerSaving] = useState(false);
  const [positionerError, setPositionerError] = useState('');

  if (!show) return null;

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setPositionerError('');
    setPositionerImageSrc(URL.createObjectURL(f));
  };

  const openRepositioner = () => {
    if (!preview) return;
    setPositionerError('');
    setPositionerImageSrc(preview);
  };

  const closePositioner = () => {
    if (positionerImageSrc?.startsWith('blob:')) URL.revokeObjectURL(positionerImageSrc);
    setPositionerImageSrc(null);
    setPositionerError('');
  };

  const handlePositionerSave = async ({ croppedAreaPixels }) => {
    setPositionerSaving(true);
    setPositionerError('');
    try {
      const blob = await getCroppedImageBlob(positionerImageSrc, croppedAreaPixels, {
        outputWidth: 480,
        outputHeight: 480,
      });
      setPreview(URL.createObjectURL(blob));
      setFile(blobToFile(blob, 'avatar.png'));
      closePositioner();
    } catch (err) {
      console.error('Error positioning image:', err);
      setPositionerError('Could not process that image. You can try Save again, or Cancel and pick a different file.');
    } finally {
      setPositionerSaving(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;

    // Validate phone if provided
    let normalizedPhone = null;
    const trimmedPhone = smsPhoneInput.trim();
    if (trimmedPhone) {
      normalizedPhone = normalizeE164(trimmedPhone);
      if (!normalizedPhone) {
        setPhoneError('Enter a valid mobile, e.g. 0412 345 678');
        return;
      }
    }
    setPhoneError('');

    setSaving(true);
    setSaveError('');
    try {
      let avatarUrl = agent?.avatar || null;

      // A failed upload here used to be silently ignored — avatarUrl
      // quietly fell back to the old value, but the save still went
      // ahead and reported success. Now it throws, so the whole save
      // aborts with a clear error instead of a false "Saved" that hides
      // a crop the agent just made never actually landing.
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await authFetch('/api/upload-image', { method: 'POST', body: formData });
        if (!res.ok) {
          throw new Error('The new photo could not be uploaded. The previous photo is unchanged — please try again.');
        }
        const { url } = await res.json();
        avatarUrl = url;
      }

      const smsPhoneValue = normalizedPhone || null;
      const smsEnabledValue = !!smsEnabled && !!normalizedPhone;

      if (agent?.id) {
        // Edit existing
        await updateDoc(doc(db, 'agents', agent.id), {
          name: name.trim(),
          avatar: avatarUrl,
          smsPhone: smsPhoneValue,
          smsEnabled: smsEnabledValue,
        });
        onSave({
          id: agent.id,
          name: name.trim(),
          avatar: avatarUrl,
          userId,
          smsPhone: smsPhoneValue,
          smsEnabled: smsEnabledValue,
        });
      } else {
        // Create new
        const docRef = await addDoc(collection(db, 'agents'), {
          name: name.trim(),
          avatar: avatarUrl,
          userId,
          smsPhone: smsPhoneValue,
          smsEnabled: smsEnabledValue,
          createdAt: serverTimestamp(),
        });
        onSave({
          id: docRef.id,
          name: name.trim(),
          avatar: avatarUrl,
          userId,
          smsPhone: smsPhoneValue,
          smsEnabled: smsEnabledValue,
        });
      }
      onClose();
    } catch (err) {
      console.error('Agent save failed:', err);
      // Previously just logged and returned — the Save button stopped
      // spinning with zero indication anything had gone wrong, which
      // read exactly like a successful, silent no-op.
      setSaveError(err.message || 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
      >
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-slate-900">
              {agent ? 'Edit Agent' : 'Add Agent'}
            </h2>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          <div className="flex flex-col items-center gap-4 mb-5">
            <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              {preview ? (
                <img src={preview} alt="Avatar preview" className="w-24 h-24 rounded-full object-cover" />
              ) : (
                <div className="w-24 h-24 rounded-full bg-slate-100 flex items-center justify-center">
                  <User className="w-10 h-10 text-slate-300" />
                </div>
              )}
              <div className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-all">
                <Camera className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-sm font-semibold text-orange-600 hover:text-orange-700"
              >
                {preview ? 'Change photo' : 'Add photo'}
              </button>
              {preview && (
                <button
                  onClick={openRepositioner}
                  className="text-sm font-semibold text-slate-500 hover:text-slate-800"
                >
                  Reposition
                </button>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Agent Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-all"
              placeholder="e.g. John Smith"
            />
          </div>

          <div className="mt-4">
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              Mobile number
              <span className="text-slate-400 font-normal ml-1">(for SMS shortcuts)</span>
            </label>
            <input
              type="tel"
              value={smsPhoneInput}
              onChange={(e) => { setSmsPhoneInput(e.target.value); if (phoneError) setPhoneError(''); }}
              className={`w-full px-3.5 py-2.5 rounded-xl border text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-all ${phoneError ? 'border-red-300' : 'border-slate-200'}`}
              placeholder="0412 345 678"
            />
            {phoneError && (
              <p className="mt-1 text-xs text-red-600">{phoneError}</p>
            )}
          </div>

          <label className={`mt-3 flex items-center gap-3 p-3 rounded-xl border transition-colors cursor-pointer ${smsEnabled ? 'bg-orange-50 border-orange-200' : 'bg-slate-50 border-slate-200'} ${!smsPhoneInput.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <MessageCircle className={`w-4 h-4 ${smsEnabled ? 'text-orange-600' : 'text-slate-400'}`} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-900">Enable SMS shortcuts</div>
              <div className="text-xs text-slate-500">Let this team member text the Premarket number to add listings + pull reports.</div>
            </div>
            <input
              type="checkbox"
              checked={smsEnabled}
              onChange={(e) => setSmsEnabled(e.target.checked)}
              disabled={!smsPhoneInput.trim()}
              className="w-4 h-4 accent-orange-600"
            />
          </label>
        </div>

        {saveError && (
          <p className="px-6 text-sm text-red-600 mb-3">{saveError}</p>
        )}

        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-[#e48900] to-[#c64500] rounded-xl shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Saving...</> : 'Save'}
          </button>
        </div>
      </motion.div>

      {positionerImageSrc && (
        <ImagePositioner
          imageSrc={positionerImageSrc}
          aspect={1}
          cropShape="round"
          title="Position your photo"
          description="Drag to reposition. Use the slider, your scroll wheel, or pinch to zoom."
          onCancel={closePositioner}
          onSave={handlePositionerSave}
          saving={positionerSaving}
          error={positionerError}
        />
      )}
    </motion.div>
  );
}
