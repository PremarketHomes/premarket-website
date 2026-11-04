'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Camera, Loader2, ArrowLeft } from 'lucide-react';
import { Avatar } from './LeadershipHubView';

const inputClass = 'mt-1.5 w-full rounded-md border border-stone-200 bg-white px-3.5 py-3 text-sm text-stone-900 focus:outline-none focus:border-[#e38100]';
const label = 'block text-[10px] uppercase tracking-[0.16em] text-stone-400';

/**
 * Basic profile for a Leadership Hub user: name and photo. Presentational — `onSave({ firstName, lastName, file })`
 * does the work. These are the only fields; nothing about offices, roles or billing is editable here.
 */
export default function ProfileView({ initial, email, officeName, welcome = false, sample = false, hubHref = '/dashboard/leadership', onSave }) {
  const [firstName, setFirstName] = useState(initial.firstName || '');
  const [lastName, setLastName] = useState(initial.lastName || '');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(initial.avatar || null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);

  const pick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\/(jpeg|png|webp|avif|gif)$/.test(f.type)) return setError('Please choose a JPEG, PNG or WebP image.');
    if (f.size > 8 * 1024 * 1024) return setError('Please choose an image under 8 MB.');
    setError('');
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!firstName.trim()) return setError('Please enter your first name.');
    setSaving(true);
    try {
      await onSave({ firstName: firstName.trim(), lastName: lastName.trim(), file });
      setSaved(true);
    } catch (err) {
      setError(err?.message || 'We couldn’t save your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#faf9f7] text-stone-900">
      {sample && <div role="note" className="bg-[#fdf1df] border-b border-[#f0d9b5] text-[#7a4500] text-xs text-center py-2 px-4">Preview with sample details — nothing here saves.</div>}
      <header className="border-b border-stone-200 bg-[#fdfcfb]">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between">
          <Image src="https://premarketvideos.b-cdn.net/assets/logo.png" alt="Premarket" width={140} height={35} className="h-6 w-auto" unoptimized />
          {!welcome && <Link href={hubHref} className="flex items-center gap-2 text-[13px] text-stone-500 hover:text-stone-900"><ArrowLeft className="w-4 h-4" strokeWidth={1.5} />Leadership Hub</Link>}
        </div>
      </header>
      <main className="max-w-xl mx-auto px-4 sm:px-8 py-10 sm:py-14">
        <div className="h-px w-10 bg-[#e38100]" aria-hidden="true" />
        <h1 className="mt-5 font-serif text-3xl sm:text-4xl leading-tight">{welcome ? `Welcome${firstName ? `, ${firstName}` : ''}` : 'Your profile'}</h1>
        <p className="mt-3 text-sm text-stone-600">{welcome ? `Your account is ready. Take a moment to add your name and photo, then head into the ${officeName || ''} Leadership Hub.`.replace('  ', ' ') : 'How you appear in the Leadership Hub.'}</p>

        <form onSubmit={submit} className="mt-8 bg-white border border-stone-200 rounded-md p-6 sm:p-8">
          <div className="flex items-center gap-5">
            <button type="button" onClick={() => fileRef.current?.click()} className="relative group shrink-0" aria-label="Choose a profile photo">
              <Avatar name={`${firstName} ${lastName}`} src={preview} size="w-20 h-20" text="text-xl" />
              <span className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-colors"><Camera className="w-5 h-5 text-white opacity-0 group-hover:opacity-100" strokeWidth={1.5} /></span>
            </button>
            <div>
              <button type="button" onClick={() => fileRef.current?.click()} className="text-sm font-medium text-[#c64500] hover:text-[#a63a00]">{preview ? 'Change photo' : 'Add a photo'}</button>
              <p className="text-xs text-stone-400 mt-1">Optional. JPEG, PNG or WebP.</p>
            </div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pick} />
          </div>

          <div className="mt-6 grid sm:grid-cols-2 gap-4">
            <div><label htmlFor="fn" className={label}>First name</label><input id="fn" className={inputClass} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" /></div>
            <div><label htmlFor="ln" className={label}>Last name</label><input id="ln" className={inputClass} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" /></div>
          </div>
          <div className="mt-4"><span className={label}>Email</span><p className="mt-1.5 text-sm text-stone-700">{email}</p></div>

          {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
          {saved && !error && <p role="status" className="mt-4 text-sm text-emerald-700">Saved.</p>}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={saving} className="px-6 py-3 bg-[#e38100] hover:bg-[#cc7400] disabled:opacity-60 text-white text-sm font-semibold tracking-wide rounded-md transition-colors inline-flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}{welcome ? 'Save and continue' : 'Save'}
            </button>
            {welcome && <Link href={hubHref} className="text-sm text-stone-500 hover:text-stone-900">Skip for now</Link>}
          </div>
        </form>
      </main>
    </div>
  );
}
