'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import * as Sentry from '@sentry/nextjs';
import { auth } from '../firebase/clientApp';
import { fetchUserData } from './fetchUserData';

const AuthContext = createContext();

// The signed-in user's own profile, kept for this browser session (sessionStorage: gone when the browser session
// ends, cleared on sign-out, keyed by uid). It lets a reload or a new tab render straight away once Firebase has
// confirmed who is signed in, instead of waiting for the profile read; the profile is then re-read and replaced.
// Authentication is never skipped (nothing is shown until Firebase restores the session), and every permission is
// still enforced by the server and Firestore rules, never by this copy.
const PROFILE_CACHE_KEY = 'premarket_profile_v1';
function readCachedProfile(uid) {
  try {
    const raw = typeof window !== 'undefined' ? window.sessionStorage.getItem(PROFILE_CACHE_KEY) : null;
    const v = raw ? JSON.parse(raw) : null;
    return v && v.uid === uid && v.data && typeof v.data === 'object' ? v.data : null;
  } catch { return null; }
}
function writeCachedProfile(uid, data) {
  try { if (typeof window !== 'undefined') window.sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ uid, data })); } catch { /* storage full/unavailable: no cache */ }
}
function clearCachedProfile() {
  try { if (typeof window !== 'undefined') window.sessionStorage.removeItem(PROFILE_CACHE_KEY); } catch { /* ignore */ }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        Sentry.setUser({ id: firebaseUser.uid, email: firebaseUser.email });
        const cached = readCachedProfile(firebaseUser.uid);
        if (cached) {
          // Signed in (Firebase confirmed): render now with this session's copy, refresh it below.
          setUserData(cached);
          setLoading(false);
        }
        try {
          const data = await fetchUserData(firebaseUser.uid);
          if (data) {
            setUserData(data);
            writeCachedProfile(firebaseUser.uid, data);
          }
        } catch (err) {
          console.error('Error fetching user data:', err);
        }
      } else {
        setUser(null);
        setUserData(null);
        clearCachedProfile();
        Sentry.setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const router = useRouter();

  const signOut = useCallback(async () => {
    try {
      clearCachedProfile();
      await firebaseSignOut(auth);
      setUser(null);
      setUserData(null);
      router.push('/');
    } catch (err) {
      console.error('Error signing out:', err);
    }
  }, [router]);

  // userData is otherwise only read once at sign-in, so fields a
  // server route sets mid-session (e.g. officeId/isOfficeAdmin from
  // POST /api/offices) stay stale — and the sidebar's Office link
  // missing — until the next reload. Callers await this before
  // navigating. Retries once, never throws, and resolves to whether
  // userData is now fresh: callers MUST fall back to a full page load
  // (which re-reads it from scratch) when it resolves false.
  const refreshUserData = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = await fetchUserData(uid);
        if (data) {
          setUserData(data);
          writeCachedProfile(uid, data);
          return true;
        }
      } catch (err) {
        console.error('Error refreshing user data:', err);
      }
    }
    return false;
  }, []);

  return (
    <AuthContext.Provider value={{ user, userData, setUserData, refreshUserData, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
