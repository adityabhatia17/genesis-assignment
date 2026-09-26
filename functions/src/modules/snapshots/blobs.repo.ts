import type { Firestore } from 'firebase-admin/firestore';
import { AppError } from '../../shared/app-error.js';
import { paths } from '../../shared/firestore-paths.js';

export class BlobsRepo {
  constructor(private readonly db: Firestore) {}

  ref(uid: string, pid: string, sha: string) {
    return this.db.doc(paths.blob(uid, pid, sha));
  }

  /** Blobs are immutable and content-addressed, so reading them outside a transaction is safe. */
  async readMany(uid: string, pid: string, shas: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(shas)];
    if (unique.length === 0) return new Map();
    const snaps = await this.db.getAll(...unique.map((s) => this.ref(uid, pid, s)));
    const out = new Map<string, string>();
    for (const s of snaps) {
      if (!s.exists) throw new AppError('INTERNAL', `Missing blob ${s.id}`);
      out.set(s.id, s.get('content') as string);
    }
    return out;
  }
}
