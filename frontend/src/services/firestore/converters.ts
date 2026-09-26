import type {
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  SnapshotOptions,
} from 'firebase/firestore';
import type { WithId } from './types';

/**
 * Read-only converter: adds the document id and reads pending server timestamps as local estimates.
 * Client writes use untyped references (they need serverTimestamp()).
 */
export function readConverter<T>(): FirestoreDataConverter<WithId<T>> {
  return {
    toFirestore(): never {
      throw new Error('Read-only converter: write with an untyped reference.');
    },
    fromFirestore(snapshot: QueryDocumentSnapshot, options?: SnapshotOptions): WithId<T> {
      const data = snapshot.data({ ...options, serverTimestamps: 'estimate' }) as T;
      return { ...data, id: snapshot.id };
    },
  };
}
