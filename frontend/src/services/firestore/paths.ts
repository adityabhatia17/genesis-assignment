import type { Timestamp } from 'firebase/firestore';
import { collection, doc } from 'firebase/firestore';
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
import { db } from '@/lib/firebase';
import { readConverter } from './converters';

const project = (uid: string, pid: string) => ['users', uid, 'projects', pid] as const;

/** Typed references for every path the SPA reads (07 §3.5). `*Raw` references are for client writes. */
export const refs = {
  integration: (uid: string) =>
    doc(db(), 'users', uid, 'integrations', 'highlevel').withConverter(
      readConverter<IntegrationDoc<Timestamp>>(),
    ),
  projects: (uid: string) =>
    collection(db(), 'users', uid, 'projects').withConverter(
      readConverter<ProjectDoc<Timestamp>>(),
    ),
  projectsRaw: (uid: string) => collection(db(), 'users', uid, 'projects'),
  project: (uid: string, pid: string) =>
    doc(db(), ...project(uid, pid)).withConverter(readConverter<ProjectDoc<Timestamp>>()),
  projectRaw: (uid: string, pid: string) => doc(db(), ...project(uid, pid)),
  files: (uid: string, pid: string) =>
    collection(db(), ...project(uid, pid), 'files').withConverter(
      readConverter<FileDoc<Timestamp>>(),
    ),
  messages: (uid: string, pid: string) =>
    collection(db(), ...project(uid, pid), 'messages').withConverter(
      readConverter<MessageDoc<Timestamp>>(),
    ),
  generations: (uid: string, pid: string) =>
    collection(db(), ...project(uid, pid), 'generations').withConverter(
      readConverter<GenerationDoc<Timestamp>>(),
    ),
  generation: (uid: string, pid: string, gid: string) =>
    doc(db(), ...project(uid, pid), 'generations', gid).withConverter(
      readConverter<GenerationDoc<Timestamp>>(),
    ),
  snapshots: (uid: string, pid: string) =>
    collection(db(), ...project(uid, pid), 'snapshots').withConverter(
      readConverter<SnapshotDoc<Timestamp>>(),
    ),
  snapshot: (uid: string, pid: string, sid: string) =>
    doc(db(), ...project(uid, pid), 'snapshots', sid).withConverter(
      readConverter<SnapshotDoc<Timestamp>>(),
    ),
  blob: (uid: string, pid: string, blobId: string) =>
    doc(db(), ...project(uid, pid), 'blobs', blobId).withConverter(
      readConverter<BlobDoc<Timestamp>>(),
    ),
  events: (uid: string) =>
    collection(db(), 'users', uid, 'events').withConverter(
      readConverter<UserEventDoc<Timestamp>>(),
    ),
};
