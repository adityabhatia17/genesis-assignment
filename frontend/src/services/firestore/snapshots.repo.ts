import { getDoc, limit, orderBy, query, type Query } from 'firebase/firestore';
import { refs } from './paths';
import type { Snapshot } from './types';

export const SNAPSHOT_WINDOW = 50;

export const snapshotsQuery = (uid: string, projectId: string): Query<Snapshot> =>
  query(refs.snapshots(uid, projectId), orderBy('seq', 'desc'), limit(SNAPSHOT_WINDOW));

export async function fetchSnapshot(
  uid: string,
  projectId: string,
  snapshotId: string,
): Promise<Snapshot | null> {
  const snap = await getDoc(refs.snapshot(uid, projectId, snapshotId));
  return snap.exists() ? snap.data() : null;
}

/** Blobs are immutable (content-addressed), so callers may cache them forever. */
export async function fetchBlobContent(
  uid: string,
  projectId: string,
  blobId: string,
): Promise<string | null> {
  const snap = await getDoc(refs.blob(uid, projectId, blobId));
  return snap.exists() ? snap.data().content : null;
}
