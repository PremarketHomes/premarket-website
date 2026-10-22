import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/clientApp';

/** Reads users/{uid} as the AuthContext's `userData` shape, or null if it doesn't exist (yet). */
export async function fetchUserData(uid) {
  const userDoc = await getDoc(doc(db, 'users', uid));
  return userDoc.exists() ? { id: userDoc.id, ...userDoc.data() } : null;
}
