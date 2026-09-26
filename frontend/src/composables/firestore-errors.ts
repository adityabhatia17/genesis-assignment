import type { FirestoreError } from 'firebase/firestore';
import { auth } from '@/lib/firebase';

/** Listeners fail with permission-denied for a moment after sign-out; that is not an error to show. */
export function isSignedOutDenial(error: FirestoreError): boolean {
  return error.code === 'permission-denied' && auth().currentUser === null;
}
