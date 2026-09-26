import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let db: Firestore | undefined;

export const adminApp = (): App => getApps()[0] ?? initializeApp();

export function firestore(): Firestore {
  if (!db) {
    db = getFirestore(adminApp());
    db.settings({ ignoreUndefinedProperties: true });
  }
  return db;
}

export const adminAuth = (): Auth => getAuth(adminApp());
