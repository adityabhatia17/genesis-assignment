import type { Timestamp } from 'firebase/firestore';
import type {
  BlobDoc,
  FileDoc,
  GenerationDoc,
  IntegrationDoc,
  MessageDoc,
  ProjectDoc,
  SnapshotDoc,
  UserEventDoc,
} from '@/contracts/firestore-docs';

export type WithId<T> = T & { readonly id: string };

export type Integration = WithId<IntegrationDoc<Timestamp>>;
export type Project = WithId<ProjectDoc<Timestamp>>;
export type ProjectFile = WithId<FileDoc<Timestamp>>;
export type ChatMessage = WithId<MessageDoc<Timestamp>>;
export type Generation = WithId<GenerationDoc<Timestamp>>;
export type Snapshot = WithId<SnapshotDoc<Timestamp>>;
export type BlobRecord = WithId<BlobDoc<Timestamp>>;
export type UserEvent = WithId<UserEventDoc<Timestamp>>;
