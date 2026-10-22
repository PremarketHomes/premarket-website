'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import * as Sentry from '@sentry/nextjs';
import { auth } from '../firebase/clientApp';
import { fetchUserData } from './fetchUserData';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        Sentry.setUser({ id: firebaseUser.uid, email: firebaseUser.email });
        try {
          const data = await fetchUserData(firebaseUser.uid);
          if (data) setUserData(data);
        } catch (err) {
          console.error('Error fetching user data:', err);
        }
      } else {
        setUser(null);
        setUserData(null);
        Sentry.setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const router = useRouter();

  const signOut = useCallback(async () => {
    try {
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
  // navigating. Never throws; on failure the existing userData stays.
  const refreshUserData = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      const data = await fetchUserData(uid);
      if (data) setUserData(data);
    } catch (err) {
      console.error('Error refreshing user data:', err);
    }
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
