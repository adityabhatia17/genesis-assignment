import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { paths } from '../../../shared/firestore-paths.js';

export interface OAuthStateRepo {
  create(i: {
    stateHash: string;
    uid: string;
    returnPath: string;
    nowMs: number;
    ttlMs: number;
  }): Promise<void>;
  consume(stateHash: string, nowMs: number): Promise<{ uid: string; returnPath: string } | null>;
}

export class FirestoreOAuthStateRepo implements OAuthStateRepo {
  constructor(private readonly db: Firestore) {}

  async create(i: {
    stateHash: string;
    uid: string;
    returnPath: string;
    nowMs: number;
    ttlMs: number;
  }): Promise<void> {
    await this.db.doc(paths.oauthState(i.stateHash)).create({
      uid: i.uid,
      returnPath: i.returnPath,
      createdAt: Timestamp.fromMillis(i.nowMs),
      expiresAt: Timestamp.fromMillis(i.nowMs + i.ttlMs),
      consumedAt: null,
    });
  }

  consume(stateHash: string, nowMs: number): Promise<{ uid: string; returnPath: string } | null> {
    const ref = this.db.doc(paths.oauthState(stateHash));
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const consumedAt = snap.get('consumedAt') as Timestamp | null;
      const expiresAt = snap.get('expiresAt') as Timestamp;
      if (consumedAt !== null || expiresAt.toMillis() <= nowMs) return null;
      tx.update(ref, { consumedAt: Timestamp.fromMillis(nowMs) });
      return { uid: snap.get('uid') as string, returnPath: snap.get('returnPath') as string };
    });
  }
}
