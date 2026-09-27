import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import type { Env } from './env';

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

/** Initializes Firebase once. Auth persistence is the SDK default (IndexedDB), so sessions survive reloads. */
export function initFirebase(env: Env): void {
  if (app) return;
  app = initializeApp(env.firebase);
  authInstance = getAuth(app);
  dbInstance = getFirestore(app);
  if (env.useEmulators) {
    connectAuthEmulator(authInstance, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(dbInstance, '127.0.0.1', 8080);
  }
}

export function auth(): Auth {
  if (!authInstance) throw new Error('Firebase is not initialized; call initFirebase() first.');
  return authInstance;
}

export function db(): Firestore {
  if (!dbInstance) throw new Error('Firebase is not initialized; call initFirebase() first.');
  return dbInstance;
}
