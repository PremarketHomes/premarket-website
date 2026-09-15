'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Heart } from 'lucide-react';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '../firebase/clientApp';
import { useAuth } from '../context/AuthContext';
import { isPreviewDeployment } from '../utils/previewEnvironment';

const SIZES = {
  sm: 'w-8 h-8 text-base',
  md: 'w-10 h-10 text-lg',
  lg: 'w-12 h-12 text-xl',
};

const ICON_SIZES = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
};

export default function LikeButton({
  propertyId,
  size = 'md',
  variant = 'default',
  onAuthRequired,
}) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [liked, setLiked] = useState(false);
  const [loading, setLoading] = useState(false);

  const likeDocId = user && propertyId ? `${user.uid}_${propertyId}` : null;

  // Initial state load
  useEffect(() => {
    if (!likeDocId) {
      setLiked(false);
      return;
    }
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'likes', likeDocId));
        setLiked(snap.exists());
      } catch (err) {
        console.error('LikeButton load error:', err);
      }
    })();
  }, [likeDocId]);

  const handleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (loading) return;

    if (!user) {
      if (onAuthRequired) {
        onAuthRequired();
        return;
      }
      const returnTo = pathname || '/';
      router.push(`/signup?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }

    setLoading(true);
    try {
      // Vercel Preview deployments share the same production Firestore
      // project as premarket.homes (no separate staging project exists —
      // see utils/previewEnvironment.js) — simulate the toggle visually
      // rather than writing a real like record for a preview build.
      if (isPreviewDeployment()) {
        setLiked(!liked);
        return;
      }
      const ref = doc(db, 'likes', likeDocId);
      if (liked) {
        await deleteDoc(ref);
        setLiked(false);
      } else {
        await setDoc(ref, {
          userId: user.uid,
          propertyId,
          createdAt: serverTimestamp(),
        });
        setLiked(true);
      }
    } catch (err) {
      console.error('LikeButton toggle error:', err);
    } finally {
      setLoading(false);
    }
  };

  const sizeClass = SIZES[size] || SIZES.md;
  const iconSize = ICON_SIZES[size] || ICON_SIZES.md;

  const baseClasses =
    variant === 'overlay'
      ? `${sizeClass} rounded-full flex items-center justify-center bg-slate-900/70 backdrop-blur border border-slate-700 hover:border-orange-500 transition-colors`
      : `${sizeClass} rounded-full flex items-center justify-center bg-white/90 backdrop-blur border border-slate-200 hover:border-orange-500 shadow-md transition-colors`;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      aria-label={liked ? 'Unlike property' : 'Like property'}
      className={`${baseClasses} disabled:opacity-60`}
    >
      <Heart
        className={`${iconSize} transition-colors ${
          liked
            ? 'text-orange-500 fill-orange-500'
            : variant === 'overlay'
            ? 'text-slate-300'
            : 'text-slate-400'
        }`}
      />
    </button>
  );
}
