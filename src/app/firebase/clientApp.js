import { initializeApp, getApps } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth, connectAuthEmulator } from "firebase/auth";

// Production values are the defaults, so a deployment with none of the NEXT_PUBLIC_FIREBASE_* variables set behaves
// exactly as before. A STAGING deployment sets all of them (see docs/release/STAGING_ENVIRONMENT.md) to point the browser
// at the staging project. These must match the server's FIREBASE_SERVICE_ACCOUNT project; /api/internal/environment
// reports what the server uses so a mismatch can be seen before anyone tests.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyDuUEafvE_UXtNEpU--AnkO6bh_8l5j0I8",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "premarket-homes.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "premarket-homes",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "premarket-homes.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "186906128986",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:186906128986:web:92415d938bc835479c5e63",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-82L9C6VDW5"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);

// Local development against the Firebase emulators only. Off unless NEXT_PUBLIC_USE_FIREBASE_EMULATORS=1 at build time.
if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === '1' && !globalThis.__premarketEmulatorsConnected) {
  globalThis.__premarketEmulatorsConnected = true;
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

export { db, storage, auth };
