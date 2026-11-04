'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../firebase/clientApp';
import { useAuth } from '../../../context/AuthContext';
import { useRequireAgent } from '../../../hooks/useRequireAgent';
import { authFetch } from '../../../utils/authFetch';
import ProfileView from '../ProfileView';

/** A leader's own name and photo. Writes only firstName / lastName / avatar on their own users document. */
function ProfileInner() {
  useRequireAgent();
  const router = useRouter();
  const welcome = useSearchParams().get('welcome') === '1';
  const { user, userData, loading, refreshUserData } = useAuth();

  if (loading || !user || !userData) {
    return <div className="min-h-screen bg-[#faf9f7] flex items-center justify-center"><div className="animate-spin rounded-full h-10 w-10 border-b-4 border-[#e38100]" /></div>;
  }

  async function onSave({ firstName, lastName, file }) {
    let avatar = userData.avatar || null;
    if (file) {
      const form = new FormData();
      form.append('file', file);
      const res = await authFetch('/api/upload-image', { method: 'POST', body: form });
      if (!res.ok) throw new Error('Your photo could not be uploaded. Your details were not changed — please try again.');
      avatar = (await res.json()).url;
    }
    await updateDoc(doc(db, 'users', user.uid), { firstName, lastName, ...(avatar ? { avatar } : {}) });
    await refreshUserData();
    if (welcome) router.replace('/dashboard/leadership');
  }

  return <ProfileView initial={userData} email={user.email} welcome={welcome} onSave={onSave} />;
}

export default function LeadershipProfilePage() {
  return <Suspense><ProfileInner /></Suspense>;
}
