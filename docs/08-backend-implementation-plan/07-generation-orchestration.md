# BE-6 — Generation orchestration, commit and control routes

> Read [`00-overview.md`](00-overview.md) first. Design: [`../05-backend-system-design.md`](../05-backend-system-design.md) §8.1–8.2, §8.9–8.12, §9.2. Flows: [`../07-end-to-end-system-design.md`](../07-end-to-end-system-design.md) §4.6–4.9. Persisted statuses: `07` §5.1.

**Outcome:** `POST generate/v1/projects/:projectId/generations` streams SSE protocol v1 end to end; validated files are staged durably; the working tree changes only in one atomic transaction (with a checkpoint snapshot when manual edits are unsnapshotted); every terminal path writes exactly one terminal state and one assistant message; cancel, apply-partial and discard work; 16 scenarios pass against the emulator.

---

### Task BE-6.1: Generations repository

**Files:**

- Create: `functions/src/modules/generation/persistence/generations.repo.ts`
- Test: covered by BE-6.8 (integration)

**Interfaces:**

- Consumes: `paths`, `toProjectRecord`, `isLeaseStale`, `fileIdForPath`, `utf8Bytes`, `FileOp`, `Issue`, `PartialResult`, `MessageMeta`, `LIMITS`.
- Produces:
  - `interface StartInput { uid; projectId; generationId; prompt; promptVersion; model; effort; nowMs }`
  - `interface StartResult { project: ProjectRecord; projectDescription: string }`
  - `interface FinalizeInput { uid; projectId; generationId; nowMs; status: 'failed' | 'cancelled' | 'interrupted'; error: GenerationError | null; partial: PartialResult | null; stopReason: string | null; usage: Usage | null; timings; context; assistantText: string }`
  - `interface GenerationRecord { id; status; prompt; heartbeatAtMs; partial: (PartialResult & { applied: boolean; discarded: boolean }) | null }`
  - `class GenerationsRepo { start(i); touch(uid, pid, gid, nowMs); stage(uid, pid, gid, op, warnings, nowMs); listStaged(uid, pid, gid): Promise<FileOp[]>; finalizeWithoutCommit(i): Promise<boolean>; saveRawArtifact(uid, pid, gid, text, nowMs); get(uid, pid, gid); markDiscarded(uid, pid, gid, nowMs) }`
  - helpers `interruptedPatch(stagedPaths, nowMs)`, `generationPartial(partial)`.

- [ ] **Step 1: Implement**

```ts
import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type {
  GenerationError,
  Issue,
  MessageMeta,
  PartialResult,
  TerminalGenerationStatus,
  Usage,
} from '../../../contracts/firestore-docs.js';
import { LIMITS } from '../../../contracts/limits.js';
import type { FileLanguage } from '../../../contracts/paths.js';
import { AppError } from '../../../shared/app-error.js';
import { paths } from '../../../shared/firestore-paths.js';
import { fileIdForPath, utf8Bytes } from '../../../shared/hash.js';
import {
  isLeaseStale,
  toProjectRecord,
  type ProjectRecord,
} from '../../projects/project-access.js';
import type { FileOp } from '../validation/validate-file.js';

const ts = (ms: number) => Timestamp.fromMillis(ms);

export interface StartInput {
  uid: string;
  projectId: string;
  generationId: string;
  prompt: string;
  promptVersion: string;
  model: string;
  effort: string;
  nowMs: number;
}
export interface StartResult {
  project: ProjectRecord;
  projectDescription: string;
}

export interface GenerationTimings {
  ttftMs: number | null;
  totalMs: number | null;
}
export interface GenerationContextStats {
  fileCount: number;
  historyMessages: number;
  externalIncluded: boolean;
  promptChars: number;
}

export interface FinalizeInput {
  uid: string;
  projectId: string;
  generationId: string;
  nowMs: number;
  status: 'failed' | 'cancelled' | 'interrupted';
  error: GenerationError | null;
  partial: PartialResult | null;
  stopReason: string | null;
  usage: Usage | null;
  timings: GenerationTimings;
  context: GenerationContextStats | null;
  assistantText: string;
}

export interface GenerationRecord {
  id: string;
  status: string;
  prompt: string;
  heartbeatAtMs: number;
  partial: (PartialResult & { applied: boolean; discarded: boolean }) | null;
}

export const generationPartial = (p: PartialResult | null) =>
  p ? { ...p, appliedAt: null, appliedSnapshotId: null, discardedAt: null } : null;

export function interruptedPatch(stagedPaths: string[], nowMs: number): Record<string, unknown> {
  return {
    status: 'interrupted',
    completedAt: ts(nowMs),
    error: {
      code: 'GENERATION_INTERRUPTED',
      message: 'The generation stopped unexpectedly.',
      retryable: true,
    },
    partial: generationPartial({
      stagedPaths,
      applyable: stagedPaths.length > 0,
    }),
  };
}

const assistantNote = (
  generationId: string,
  status: string,
  nowMs: number,
  text: string,
  meta: MessageMeta = {},
) => ({
  role: 'assistant',
  content: text,
  generationId,
  createdAt: ts(nowMs),
  meta: { status, ...meta },
});

export class GenerationsRepo {
  constructor(private readonly db: Firestore) {}

  private genRef(uid: string, pid: string, gid: string) {
    return this.db.doc(paths.generation(uid, pid, gid));
  }
  private projectRef(uid: string, pid: string) {
    return this.db.doc(paths.project(uid, pid));
  }

  /** Idempotency + lease + stale takeover + generation/user-message docs, in one transaction. */
  start(i: StartInput): Promise<StartResult> {
    const projectRef = this.projectRef(i.uid, i.projectId);
    const genRef = this.genRef(i.uid, i.projectId, i.generationId);
    const messages = this.db.collection(paths.messages(i.uid, i.projectId));
    return this.db.runTransaction(async (tx) => {
      const [projectSnap, genSnap] = await tx.getAll(projectRef, genRef);
      if (!projectSnap?.exists || projectSnap.get('status') !== 'active')
        throw new AppError('PROJECT_NOT_FOUND');
      if (genSnap?.exists)
        throw new AppError('DUPLICATE_REQUEST', undefined, {
          generationId: i.generationId,
          status: genSnap.get('status') as string,
        });
      const project = toProjectRecord(projectSnap.id, projectSnap.data());

      let staleId: string | null = null;
      let staleStaged: string[] = [];
      if (project.activeGeneration) {
        if (!isLeaseStale(project.activeGeneration, i.nowMs)) {
          throw new AppError('GENERATION_IN_PROGRESS', undefined, {
            activeGenerationId: project.activeGeneration.id,
          });
        }
        staleId = project.activeGeneration.id;
        const staged = await tx.get(this.db.collection(paths.staged(i.uid, i.projectId, staleId)));
        staleStaged = staged.docs
          .filter((d) => d.get('op') === 'write')
          .map((d) => d.get('path') as string);
      }

      // ── writes ──
      if (staleId) {
        tx.set(this.genRef(i.uid, i.projectId, staleId), interruptedPatch(staleStaged, i.nowMs), {
          merge: true,
        });
        tx.create(
          messages.doc(),
          assistantNote(
            staleId,
            'interrupted',
            i.nowMs - 1,
            '(This generation stopped unexpectedly.)',
          ),
        );
      }
      const now = ts(i.nowMs);
      tx.create(genRef, {
        status: 'streaming',
        prompt: i.prompt,
        promptVersion: i.promptVersion,
        model: i.model,
        effort: i.effort,
        createdAt: now,
        startedAt: now,
        completedAt: null,
        heartbeatAt: now,
        stopReason: null,
        error: null,
        result: null,
        partial: null,
        usage: null,
        timings: { ttftMs: null, totalMs: null },
        context: {
          fileCount: 0,
          historyMessages: 0,
          externalIncluded: false,
          promptChars: i.prompt.length,
        },
      });
      tx.create(messages.doc(), {
        role: 'user',
        content: i.prompt,
        generationId: i.generationId,
        createdAt: now,
        meta: null,
      });
      tx.update(projectRef, {
        activeGeneration: {
          id: i.generationId,
          startedAt: now,
          heartbeatAt: now,
        },
        updatedAt: now,
      });
      return {
        project,
        projectDescription: (projectSnap.get('description') as string | undefined) ?? '',
      };
    });
  }

  /** Heartbeat on both documents, only while this generation still holds the lease. */
  async touch(uid: string, pid: string, gid: string, nowMs: number): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.projectRef(uid, pid));
      if ((snap.get('activeGeneration.id') as string | undefined) !== gid) return;
      tx.update(this.projectRef(uid, pid), {
        'activeGeneration.heartbeatAt': ts(nowMs),
      });
      tx.update(this.genRef(uid, pid, gid), { heartbeatAt: ts(nowMs) });
    });
  }

  async stage(
    uid: string,
    pid: string,
    gid: string,
    op: FileOp,
    warnings: Issue[],
    nowMs: number,
  ): Promise<void> {
    await this.db.doc(`${paths.staged(uid, pid, gid)}/${fileIdForPath(op.path)}`).set({
      path: op.path,
      op: op.op,
      content: op.op === 'write' ? op.content : null,
      sizeBytes: op.op === 'write' ? op.sizeBytes : 0,
      contentHash: op.op === 'write' ? op.sha256 : null,
      language: op.op === 'write' ? op.language : null,
      issues: warnings,
      createdAt: ts(nowMs),
    });
  }

  async listStaged(uid: string, pid: string, gid: string): Promise<FileOp[]> {
    const snap = await this.db.collection(paths.staged(uid, pid, gid)).get();
    return snap.docs.map((d): FileOp => {
      const path = d.get('path') as string;
      if (d.get('op') === 'delete') return { op: 'delete', path };
      const content = d.get('content') as string;
      return {
        op: 'write',
        path,
        content,
        sizeBytes: utf8Bytes(content),
        sha256: d.get('contentHash') as string,
        language: d.get('language') as FileLanguage,
      };
    });
  }

  /** Terminal state without touching the working tree. Returns false if already terminal. */
  finalizeWithoutCommit(i: FinalizeInput): Promise<boolean> {
    const genRef = this.genRef(i.uid, i.projectId, i.generationId);
    const projectRef = this.projectRef(i.uid, i.projectId);
    return this.db.runTransaction(async (tx) => {
      const [genSnap, projectSnap] = await tx.getAll(genRef, projectRef);
      if (!genSnap?.exists || genSnap.get('status') !== 'streaming') return false;
      tx.update(genRef, {
        status: i.status,
        completedAt: ts(i.nowMs),
        stopReason: i.stopReason,
        error: i.error,
        partial: generationPartial(i.partial),
        usage: i.usage,
        timings: i.timings,
        ...(i.context ? { context: i.context } : {}),
      });
      tx.create(
        this.db.collection(paths.messages(i.uid, i.projectId)).doc(),
        assistantNote(i.generationId, i.status, i.nowMs, i.assistantText),
      );
      if ((projectSnap?.get('activeGeneration.id') as string | undefined) === i.generationId) {
        tx.update(projectRef, {
          activeGeneration: null,
          updatedAt: ts(i.nowMs),
        });
      }
      return true;
    });
  }

  async saveRawArtifact(
    uid: string,
    pid: string,
    gid: string,
    text: string,
    nowMs: number,
  ): Promise<void> {
    const bytes = Buffer.from(text, 'utf8');
    const truncated = bytes.length > LIMITS.rawArtifactMaxBytes;
    const kept = truncated ? bytes.subarray(0, LIMITS.rawArtifactMaxBytes).toString('utf8') : text;
    await this.db.doc(paths.rawArtifact(uid, pid, gid)).set({
      text: kept,
      truncated,
      sizeBytes: bytes.length,
      createdAt: ts(nowMs),
    });
  }

  async get(uid: string, pid: string, gid: string): Promise<GenerationRecord | null> {
    const snap = await this.genRef(uid, pid, gid).get();
    if (!snap.exists) return null;
    const partial = snap.get('partial') as
      | (PartialResult & { appliedAt: unknown; discardedAt: unknown })
      | null;
    return {
      id: snap.id,
      status: snap.get('status') as string,
      prompt: snap.get('prompt') as string,
      heartbeatAtMs: (snap.get('heartbeatAt') as Timestamp).toMillis(),
      partial: partial
        ? {
            stagedPaths: partial.stagedPaths,
            applyable: partial.applyable,
            applied: partial.appliedAt != null,
            discarded: partial.discardedAt != null,
          }
        : null,
    };
  }

  async markDiscarded(uid: string, pid: string, gid: string, nowMs: number): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.genRef(uid, pid, gid));
      if (!snap.exists) throw new AppError('GENERATION_NOT_FOUND');
      const partial = snap.get('partial') as {
        appliedAt: unknown;
        discardedAt: unknown;
      } | null;
      if (!partial || partial.appliedAt != null || partial.discardedAt != null)
        throw new AppError('GENERATION_NOT_APPLYABLE');
      tx.update(this.genRef(uid, pid, gid), {
        'partial.discardedAt': ts(nowMs),
        'partial.applyable': false,
      });
    });
    const staged = await this.db.collection(paths.staged(uid, pid, gid)).listDocuments();
    const batch = this.db.batch();
    for (const ref of staged) batch.delete(ref);
    await batch.commit();
  }
}
```

- [ ] **Step 2: Typecheck; commit** — `feat(functions): add generations repository (start, heartbeat, staging, finalize)`.

---

### Task BE-6.2: Lease helpers

The lease rules live in `project-access.ts` (`isLeaseStale`) and in the repositories above (start) plus the commit primitive (BE-6.4 `leaseMode`). No new file is needed; this task adds the **unit test** that pins the rule.

**Files:**

- Test: `functions/test/unit/projects/lease.test.ts`

- [ ] **Step 1: Test**

```ts
import { isLeaseStale } from '../../../src/modules/projects/project-access.js';

describe('lease staleness', () => {
  it('is stale only after 60 s without heartbeat', () => {
    expect(isLeaseStale(null, 1_000_000)).toBe(false);
    expect(isLeaseStale({ heartbeatAtMs: 1_000_000 }, 1_060_000)).toBe(false);
    expect(isLeaseStale({ heartbeatAtMs: 1_000_000 }, 1_060_001)).toBe(true);
  });
});
```

- [ ] **Step 2: Run → PASS; commit** — `test(functions): pin generation lease staleness rule`.

---

### Task BE-6.3: Blobs and snapshot builder

**Files:**

- Create: `functions/src/modules/snapshots/snapshot-builder.ts`, `functions/src/modules/snapshots/blobs.repo.ts`
- Test: `functions/test/unit/snapshots/snapshot-builder.test.ts`

**Interfaces:**

- Produces: `manifestOf(tree: Tree): Record<string, SnapshotFileEntry>` (keyed by `fileIdForPath(path)`), `diffManifests(parent | null, next): { changedPaths; deletedPaths }`, `treeBytes(tree)`, `snapshotLabel(kind, text)`; `class BlobsRepo { ref(uid, pid, sha); readMany(uid, pid, shas): Promise<Map<string, string>> }`.

- [ ] **Step 1: Test**

```ts
import { diffManifests, manifestOf } from '../../../src/modules/snapshots/snapshot-builder.js';
import type { TreeFile } from '../../../src/modules/generation/validation/validate-project.js';

const f = (path: string, sha: string): TreeFile => ({
  path,
  content: sha,
  sizeBytes: 1,
  sha256: sha,
  language: 'javascript',
});
const tree = (...files: TreeFile[]) => new Map(files.map((x) => [x.path, x]));

describe('snapshot builder', () => {
  it('builds manifests keyed by file id', () => {
    const m = manifestOf(tree(f('app.js', 'a')));
    expect(Object.values(m)).toEqual([
      { path: 'app.js', blobId: 'a', sizeBytes: 1, language: 'javascript' },
    ]);
  });
  it('diffs added, modified and deleted paths', () => {
    const parent = manifestOf(tree(f('a.js', '1'), f('b.js', '2'), f('c.js', '3')));
    const next = manifestOf(tree(f('a.js', '1'), f('b.js', 'X'), f('d.js', '4')));
    expect(diffManifests(parent, next)).toEqual({
      changedPaths: ['b.js', 'd.js'],
      deletedPaths: ['c.js'],
    });
    expect(diffManifests(null, next).changedPaths).toEqual(['a.js', 'b.js', 'd.js']);
  });
});
```

- [ ] **Step 2: Implement `snapshot-builder.ts`**

```ts
import type { SnapshotFileEntry, SnapshotKind } from '../../contracts/firestore-docs.js';
import { fileIdForPath } from '../../shared/hash.js';
import type { Tree } from '../generation/validation/validate-project.js';

export function manifestOf(tree: Tree): Record<string, SnapshotFileEntry> {
  const out: Record<string, SnapshotFileEntry> = {};
  for (const f of tree.values())
    out[fileIdForPath(f.path)] = {
      path: f.path,
      blobId: f.sha256,
      sizeBytes: f.sizeBytes,
      language: f.language,
    };
  return out;
}

export function diffManifests(
  parent: Record<string, SnapshotFileEntry> | null,
  next: Record<string, SnapshotFileEntry>,
): { changedPaths: string[]; deletedPaths: string[] } {
  const before = new Map(Object.values(parent ?? {}).map((e) => [e.path, e.blobId]));
  const after = new Map(Object.values(next).map((e) => [e.path, e.blobId]));
  const changedPaths = [...after]
    .filter(([p, blob]) => before.get(p) !== blob)
    .map(([p]) => p)
    .sort();
  const deletedPaths = [...before.keys()].filter((p) => !after.has(p)).sort();
  return { changedPaths, deletedPaths };
}

export const treeBytes = (tree: Tree): number =>
  [...tree.values()].reduce((s, f) => s + f.sizeBytes, 0);

export function snapshotLabel(kind: SnapshotKind, text: string): string {
  const base = kind === 'generation' ? text : kind === 'restore' ? text : `Checkpoint: ${text}`;
  return base.length > 120 ? `${base.slice(0, 117)}…` : base;
}
```

- [ ] **Step 3: Implement `blobs.repo.ts`**

```ts
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
```

- [ ] **Step 4: Run tests → PASS; commit** — `feat(functions): add content-addressed blobs and snapshot manifests`.

---

### Task BE-6.4: Commit primitive (`applyTreeChange`)

**Files:**

- Create: `functions/src/modules/generation/persistence/commit.service.ts`
- Test: `functions/test/integration/generation/commit.service.test.ts`

**Interfaces:**

- Consumes: `toProjectRecord`, `isLeaseStale`, `interruptedPatch`, `applyOps`, `validateProject`, `manifestOf`, `diffManifests`, `treeBytes`, `snapshotLabel`, `fileIdForPath`, `BlobsRepo`.
- Produces:
  - `interface TreeChangeInput { uid; projectId; nowMs; ops: FileOp[]; source: 'ai' | 'restore'; snapshot: { kind: 'generation' | 'restore'; label: string; generationId: string | null; restoredFromSnapshotId: string | null }; lease: { mode: 'must-hold'; generationId: string } | { mode: 'must-be-free' }; validateNextTree: boolean; replaceTree?: boolean; precondition?: (p: ProjectRecord) => void; messages: MessageDraft[]; generationPatch?: { generationId: string; build(result: CommitResult): Record<string, unknown> } }`
  - `interface MessageDraft { role: 'assistant' | 'system'; content: string; generationId: string | null; meta: MessageMeta | null }`
  - `interface CommitResult { snapshotId; snapshotSeq; checkpointSnapshotId: string | null; changedPaths: string[]; deletedPaths: string[]; noChanges: boolean }`
  - `class CommitService { applyTreeChange(i): Promise<CommitResult> }`

- [ ] **Step 1: Implement**

```ts
import {
  Timestamp,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import type { MessageMeta, SnapshotFileEntry } from '../../../contracts/firestore-docs.js';
import type { FileLanguage } from '../../../contracts/paths.js';
import { AppError } from '../../../shared/app-error.js';
import { paths } from '../../../shared/firestore-paths.js';
import { fileIdForPath } from '../../../shared/hash.js';
import {
  isLeaseStale,
  toProjectRecord,
  type ProjectRecord,
} from '../../projects/project-access.js';
import type { BlobsRepo } from '../../snapshots/blobs.repo.js';
import {
  diffManifests,
  manifestOf,
  snapshotLabel,
  treeBytes,
} from '../../snapshots/snapshot-builder.js';
import { applyOps, validateProject, type TreeFile } from '../validation/validate-project.js';
import type { FileOp } from '../validation/validate-file.js';
import { interruptedPatch } from './generations.repo.js';

export interface MessageDraft {
  role: 'assistant' | 'system';
  content: string;
  generationId: string | null;
  meta: MessageMeta | null;
}

export interface CommitResult {
  snapshotId: string;
  snapshotSeq: number;
  checkpointSnapshotId: string | null;
  changedPaths: string[];
  deletedPaths: string[];
  noChanges: boolean;
}

export interface TreeChangeInput {
  uid: string;
  projectId: string;
  nowMs: number;
  ops: readonly FileOp[];
  source: 'ai' | 'restore';
  snapshot: {
    kind: 'generation' | 'restore';
    label: string;
    generationId: string | null;
    restoredFromSnapshotId: string | null;
  };
  lease: { mode: 'must-hold'; generationId: string } | { mode: 'must-be-free' };
  validateNextTree: boolean;
  /** Restore: delete every current file that `ops` does not write. */
  replaceTree?: boolean;
  precondition?: (p: ProjectRecord) => void;
  messages: readonly MessageDraft[];
  generationPatch?: {
    generationId: string;
    build(result: CommitResult): Record<string, unknown>;
  };
}

interface WorkingFile extends TreeFile {
  fileId: string;
  version: number;
}

export class CommitService {
  constructor(
    private readonly db: Firestore,
    private readonly blobs: BlobsRepo,
  ) {}

  applyTreeChange(i: TreeChangeInput): Promise<CommitResult> {
    return this.db.runTransaction((tx) => this.run(tx, i)); // the Admin SDK retries on contention
  }

  private async run(tx: Transaction, i: TreeChangeInput): Promise<CommitResult> {
    const now = Timestamp.fromMillis(i.nowMs);
    const projectRef = this.db.doc(paths.project(i.uid, i.projectId));

    // ── reads ────────────────────────────────────────────────────────────────
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists || projectSnap.get('status') !== 'active')
      throw new AppError('PROJECT_NOT_FOUND');
    const project = toProjectRecord(projectSnap.id, projectSnap.data());
    i.precondition?.(project);

    let staleTakeover: { id: string; stagedPaths: string[] } | null = null;
    if (i.lease.mode === 'must-hold') {
      if (project.activeGeneration?.id !== i.lease.generationId)
        throw new AppError('GENERATION_INTERRUPTED', 'The generation lost its project lease.');
    } else if (project.activeGeneration) {
      if (!isLeaseStale(project.activeGeneration, i.nowMs)) {
        throw new AppError('GENERATION_IN_PROGRESS', undefined, {
          activeGenerationId: project.activeGeneration.id,
        });
      }
      const staged = await tx.get(
        this.db.collection(paths.staged(i.uid, i.projectId, project.activeGeneration.id)),
      );
      staleTakeover = {
        id: project.activeGeneration.id,
        stagedPaths: staged.docs.map((d) => d.get('path') as string),
      };
    }

    const filesSnap = await tx.get(this.db.collection(paths.files(i.uid, i.projectId)));
    const current = new Map<string, WorkingFile>();
    for (const d of filesSnap.docs) {
      current.set(d.get('path') as string, {
        fileId: d.id,
        path: d.get('path') as string,
        content: d.get('content') as string,
        sizeBytes: d.get('sizeBytes') as number,
        sha256: d.get('contentHash') as string,
        language: d.get('language') as FileLanguage,
        version: d.get('version') as number,
      });
    }
    const latestSnap = project.latestSnapshotId
      ? await tx.get(this.db.doc(paths.snapshot(i.uid, i.projectId, project.latestSnapshotId)))
      : null;
    const latestManifest =
      (latestSnap?.exists
        ? (latestSnap.get('files') as Record<string, SnapshotFileEntry>)
        : null) ?? null;

    const effectiveOps: FileOp[] = [...i.ops];
    if (i.replaceTree) {
      const written = new Set(i.ops.filter((o) => o.op === 'write').map((o) => o.path));
      for (const path of current.keys())
        if (!written.has(path)) effectiveOps.push({ op: 'delete', path });
    }
    const next = applyOps(current, effectiveOps);
    if (i.validateNextTree) {
      const issues = validateProject(next).filter((x) => x.severity === 'error');
      if (issues.length > 0) throw new AppError('GENERATION_INVALID_OUTPUT', undefined, { issues });
    }

    const checkpoint = project.workingTreeDirty && current.size > 0;
    const neededHashes = new Map<string, string>(); // sha → content
    if (checkpoint) for (const f of current.values()) neededHashes.set(f.sha256, f.content);
    for (const f of next.values()) neededHashes.set(f.sha256, f.content);
    const blobRefs: DocumentReference[] = [...neededHashes.keys()].map((sha) =>
      this.blobs.ref(i.uid, i.projectId, sha),
    );
    const blobSnaps = blobRefs.length
      ? await tx.getAll(...blobRefs, { fieldMask: ['sizeBytes'] })
      : [];

    // ── writes ───────────────────────────────────────────────────────────────
    blobSnaps.forEach((snap, idx) => {
      if (snap.exists) return;
      const sha = blobRefs[idx]!.id;
      const content = neededHashes.get(sha) ?? '';
      tx.create(blobRefs[idx]!, {
        content,
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        createdAt: now,
      });
    });

    if (staleTakeover) {
      tx.set(
        this.db.doc(paths.generation(i.uid, i.projectId, staleTakeover.id)),
        interruptedPatch(staleTakeover.stagedPaths, i.nowMs),
        { merge: true },
      );
    }

    const snapshots = this.db.collection(paths.snapshots(i.uid, i.projectId));
    let seq = project.snapshotSeq;
    let parentId = project.latestSnapshotId;
    let parentManifest = latestManifest;
    let checkpointSnapshotId: string | null = null;

    if (checkpoint) {
      seq += 1;
      const cpRef = snapshots.doc();
      const manifest = manifestOf(current);
      tx.create(cpRef, {
        seq,
        kind: 'checkpoint',
        label: snapshotLabel(
          'checkpoint',
          i.snapshot.kind === 'restore'
            ? 'manual edits before restore'
            : 'manual edits before AI changes',
        ),
        generationId: null,
        restoredFromSnapshotId: null,
        parentSnapshotId: parentId,
        files: manifest,
        fileCount: current.size,
        totalBytes: treeBytes(current),
        ...diffManifests(parentManifest, manifest),
        createdAt: now,
      });
      checkpointSnapshotId = cpRef.id;
      parentId = cpRef.id;
      parentManifest = manifest;
    }

    let changedFiles = 0;
    for (const op of effectiveOps) {
      const ref = this.db.doc(paths.file(i.uid, i.projectId, fileIdForPath(op.path)));
      const existing = current.get(op.path);
      if (op.op === 'delete') {
        if (existing) {
          tx.delete(ref);
          changedFiles += 1;
        }
        continue;
      }
      if (existing?.sha256 === op.sha256) continue;
      tx.set(ref, {
        path: op.path,
        language: op.language,
        content: op.content,
        sizeBytes: op.sizeBytes,
        contentHash: op.sha256,
        version: (existing?.version ?? 0) + 1,
        source: i.source,
        updatedAt: now,
        lastGenerationId: i.snapshot.generationId,
      });
      changedFiles += 1;
    }

    seq += 1;
    const snapRef = snapshots.doc();
    const manifest = manifestOf(next);
    const diff = diffManifests(parentManifest, manifest);
    tx.create(snapRef, {
      seq,
      kind: i.snapshot.kind,
      label: snapshotLabel(i.snapshot.kind, i.snapshot.label),
      generationId: i.snapshot.generationId,
      restoredFromSnapshotId: i.snapshot.restoredFromSnapshotId,
      parentSnapshotId: parentId,
      files: manifest,
      fileCount: next.size,
      totalBytes: treeBytes(next),
      ...diff,
      createdAt: now,
    });

    const result: CommitResult = {
      snapshotId: snapRef.id,
      snapshotSeq: seq,
      checkpointSnapshotId,
      changedPaths: diff.changedPaths,
      deletedPaths: diff.deletedPaths,
      noChanges: changedFiles === 0,
    };

    const messages = this.db.collection(paths.messages(i.uid, i.projectId));
    for (const m of i.messages) {
      tx.create(messages.doc(), {
        role: m.role,
        content: m.content,
        generationId: m.generationId,
        createdAt: now,
        // Every message written with a commit points at its snapshot and carries the diff summary the chat renders.
        meta: {
          ...(m.meta ?? {}),
          snapshotId: result.snapshotId,
          snapshotSeq: result.snapshotSeq,
          changedPaths: result.changedPaths,
          deletedPaths: result.deletedPaths,
        },
      });
    }
    if (i.generationPatch) {
      tx.update(
        this.db.doc(paths.generation(i.uid, i.projectId, i.generationPatch.generationId)),
        i.generationPatch.build(result),
      );
    }
    tx.update(projectRef, {
      latestSnapshotId: snapRef.id,
      snapshotSeq: seq,
      fileCount: next.size,
      totalBytes: treeBytes(next),
      workingTreeDirty: false,
      updatedAt: now,
      ...(i.snapshot.kind === 'generation' ? { lastGenerationAt: now } : {}),
      ...(i.lease.mode === 'must-hold' || staleTakeover ? { activeGeneration: null } : {}),
    });
    return result;
  }
}
```

- [ ] **Step 2: Integration test (emulator)** — covers: first commit (3 writes → snapshot #1, 3 blobs, versions 1); second commit changing one file (snapshot #2 with `changedPaths` = that file; blob count 4, not 6); identical content is a no-op (`noChanges: true`, no version bump); dirty tree → checkpoint snapshot before the new one (seq +2); `must-hold` with a different lease → `GENERATION_INTERRUPTED`; `must-be-free` with a fresh lease → `GENERATION_IN_PROGRESS`; `validateNextTree` failure → `GENERATION_INVALID_OUTPUT` and nothing written.

```ts
import { Timestamp } from 'firebase-admin/firestore';
import { CommitService } from '../../../src/modules/generation/persistence/commit.service.js';
import { BlobsRepo } from '../../../src/modules/snapshots/blobs.repo.js';
import {
  validateWrite,
  type FileOp,
} from '../../../src/modules/generation/validation/validate-file.js';
import {
  DEMO_APP_JS,
  DEMO_INDEX_HTML,
  DEMO_STYLES_CSS,
} from '../../../src/modules/generation/llm/fake-scripts.js';
import { firestore } from '../../../src/shared/firebase-admin.js';

const db = firestore();
const commits = new CommitService(db, new BlobsRepo(db));
const NOW = Date.parse('2026-10-01T12:00:00Z');
const op = (p: string, c: string) => validateWrite(p, c).op as FileOp;
const demoOps = () => [
  op('index.html', DEMO_INDEX_HTML),
  op('styles.css', DEMO_STYLES_CSS),
  op('app.js', DEMO_APP_JS),
];

async function seedProject(uid: string, pid: string, extra: Record<string, unknown> = {}) {
  await db.doc(`users/${uid}/projects/${pid}`).set({
    name: 'P',
    description: '',
    locationId: null,
    status: 'active',
    createdAt: Timestamp.fromMillis(NOW),
    updatedAt: Timestamp.fromMillis(NOW),
    deletedAt: null,
    ...extra,
  });
}
const base = (uid: string, pid: string, ops: FileOp[]) => ({
  uid,
  projectId: pid,
  nowMs: NOW,
  ops,
  source: 'ai' as const,
  validateNextTree: true,
  messages: [],
  snapshot: {
    kind: 'generation' as const,
    label: 'Build it',
    generationId: null,
    restoredFromSnapshotId: null,
  },
  lease: { mode: 'must-be-free' as const },
});

describe('CommitService.applyTreeChange', () => {
  it('creates files, blobs and snapshot #1, then dedupes blobs on refinement', async () => {
    await seedProject('u', 'p1');
    const r1 = await commits.applyTreeChange(base('u', 'p1', demoOps()));
    expect(r1).toMatchObject({
      snapshotSeq: 1,
      changedPaths: ['app.js', 'index.html', 'styles.css'],
      noChanges: false,
    });
    const r2 = await commits.applyTreeChange(
      base('u', 'p1', [op('app.js', `${DEMO_APP_JS}\n// v2`)]),
    );
    expect(r2).toMatchObject({
      snapshotSeq: 2,
      changedPaths: ['app.js'],
      deletedPaths: [],
    });
    expect((await db.collection('users/u/projects/p1/blobs').get()).size).toBe(4);
    const r3 = await commits.applyTreeChange(
      base('u', 'p1', [op('app.js', `${DEMO_APP_JS}\n// v2`)]),
    );
    expect(r3).toMatchObject({
      snapshotSeq: 3,
      noChanges: true,
      changedPaths: [],
    });
  });

  it('checkpoints a dirty tree first', async () => {
    await seedProject('u', 'p2');
    await commits.applyTreeChange(base('u', 'p2', demoOps()));
    await db.doc('users/u/projects/p2').update({ workingTreeDirty: true });
    const r = await commits.applyTreeChange(base('u', 'p2', [op('styles.css', 'body{color:red}')]));
    expect(r.checkpointSnapshotId).not.toBeNull();
    expect(r.snapshotSeq).toBe(3);
    expect((await db.doc('users/u/projects/p2').get()).get('workingTreeDirty')).toBe(false);
  });

  it('enforces the lease and whole-tree validation', async () => {
    await seedProject('u', 'p3', {
      activeGeneration: {
        id: 'g1',
        startedAt: Timestamp.fromMillis(NOW),
        heartbeatAt: Timestamp.fromMillis(NOW),
      },
    });
    await expect(commits.applyTreeChange(base('u', 'p3', demoOps()))).rejects.toMatchObject({
      code: 'GENERATION_IN_PROGRESS',
    });
    await expect(
      commits.applyTreeChange({
        ...base('u', 'p3', demoOps()),
        lease: { mode: 'must-hold', generationId: 'other' },
      }),
    ).rejects.toMatchObject({ code: 'GENERATION_INTERRUPTED' });
    await expect(
      commits.applyTreeChange({
        ...base('u', 'p3', [op('index.html', DEMO_INDEX_HTML)]),
        lease: { mode: 'must-hold', generationId: 'g1' },
      }),
    ).rejects.toMatchObject({ code: 'GENERATION_INVALID_OUTPUT' });
    expect((await db.collection('users/u/projects/p3/files').get()).size).toBe(0);
  });
});
```

- [ ] **Step 3: Run `npm run test:integration` → PASS; commit** — `feat(functions): add atomic tree-change commit with checkpoints and snapshots`.

---

### Task BE-6.5: Outcome decision and orchestrator

**Files:**

- Create: `functions/src/modules/generation/outcome.ts`, `functions/src/modules/generation/orchestrator.ts`
- Test: `functions/test/unit/generation/outcome.test.ts`

**Interfaces:**

- Produces: `type Termination = 'completed' | 'cancelled' | 'disconnected' | 'timeout' | 'provider_error'`; `interface OutcomeInput { termination; providerErrorCode?; stopReason; ops: FileOp[]; rejected: RejectedFile[]; aborted: RejectedFile[]; currentTree: Tree | null }`; `type Decision = { kind: 'commit'; warnings: Issue[] } | { kind: 'fail'; status: 'failed' | 'cancelled' | 'interrupted'; error: GenerationError | null; partial: PartialResult | null }`; `decideOutcome(i): Decision`; `class GenerationOrchestrator(deps) { run(req, res, input) }`.

- [ ] **Step 1: Outcome tests (the table in `05` §8.9)**

```ts
import { decideOutcome } from '../../../src/modules/generation/outcome.js';
import {
  validateWrite,
  type FileOp,
} from '../../../src/modules/generation/validation/validate-file.js';
import {
  DEMO_APP_JS,
  DEMO_INDEX_HTML,
  DEMO_STYLES_CSS,
} from '../../../src/modules/generation/llm/fake-scripts.js';
import { applyOps } from '../../../src/modules/generation/validation/validate-project.js';

const op = (p: string, c: string) => validateWrite(p, c).op as FileOp;
const demo = [
  op('index.html', DEMO_INDEX_HTML),
  op('styles.css', DEMO_STYLES_CSS),
  op('app.js', DEMO_APP_JS),
];
const empty = new Map();
const base = {
  stopReason: 'end_turn',
  ops: demo,
  rejected: [],
  aborted: [],
  currentTree: empty,
} as const;

describe('decideOutcome', () => {
  it('commits a valid completed stream', () => {
    expect(decideOutcome({ ...base, termination: 'completed' })).toEqual({
      kind: 'commit',
      warnings: [],
    });
  });
  it('commits a no-op for a question', () => {
    expect(decideOutcome({ ...base, termination: 'completed', ops: [] })).toEqual({
      kind: 'commit',
      warnings: [],
    });
  });
  it('fails with applyable partial on cancel/disconnect/timeout/provider error', () => {
    const partial = {
      stagedPaths: ['app.js', 'index.html', 'styles.css'],
      applyable: true,
    };
    expect(decideOutcome({ ...base, termination: 'cancelled' })).toMatchObject({
      kind: 'fail',
      status: 'cancelled',
      partial,
    });
    expect(decideOutcome({ ...base, termination: 'disconnected' })).toMatchObject({
      status: 'interrupted',
      partial,
    });
    expect(decideOutcome({ ...base, termination: 'timeout' })).toMatchObject({
      status: 'failed',
      error: { code: 'GENERATION_TIMEOUT' },
    });
    expect(
      decideOutcome({
        ...base,
        termination: 'provider_error',
        providerErrorCode: 'LLM_UNAVAILABLE',
      }),
    ).toMatchObject({
      status: 'failed',
      error: { code: 'LLM_UNAVAILABLE', retryable: true },
    });
  });
  it('marks partials that would break the project as not applyable', () => {
    const d = decideOutcome({
      ...base,
      termination: 'cancelled',
      ops: [op('index.html', DEMO_INDEX_HTML)],
    });
    expect(d).toMatchObject({
      partial: { stagedPaths: ['index.html'], applyable: false },
    });
    const existing = applyOps(new Map(), demo);
    expect(
      decideOutcome({
        ...base,
        termination: 'cancelled',
        ops: [op('index.html', DEMO_INDEX_HTML)],
        currentTree: existing,
      }),
    ).toMatchObject({ partial: { applyable: true } });
  });
  it('handles refusal, truncation and invalid projects', () => {
    expect(
      decideOutcome({
        ...base,
        termination: 'completed',
        stopReason: 'refusal',
      }),
    ).toMatchObject({ error: { code: 'GENERATION_REFUSED' }, partial: null });
    expect(
      decideOutcome({
        ...base,
        termination: 'completed',
        stopReason: 'max_tokens',
        ops: [],
        aborted: [{ path: 'app.js', issues: [] }],
      }),
    ).toMatchObject({ error: { code: 'GENERATION_TRUNCATED' } });
    expect(
      decideOutcome({
        ...base,
        termination: 'completed',
        ops: [op('index.html', DEMO_INDEX_HTML)],
      }),
    ).toMatchObject({
      error: { code: 'GENERATION_INVALID_OUTPUT' },
      partial: { applyable: false },
    });
    expect(
      decideOutcome({
        ...base,
        termination: 'completed',
        stopReason: 'model_context_window_exceeded',
      }),
    ).toMatchObject({ error: { code: 'CONTEXT_TOO_LARGE' } });
  });
  it('adds a truncation warning when committing after max_tokens', () => {
    const d = decideOutcome({
      ...base,
      termination: 'completed',
      stopReason: 'max_tokens',
      aborted: [{ path: 'extra.js', issues: [] }],
    });
    expect(d).toMatchObject({
      kind: 'commit',
      warnings: [expect.objectContaining({ code: 'TRUNCATED' })],
    });
  });
});
```

- [ ] **Step 2: Implement `outcome.ts`**

```ts
import { defaultMessage, isRetryable, type ErrorCode } from '../../contracts/errors.js';
import type { GenerationError, Issue, PartialResult } from '../../contracts/firestore-docs.js';
import type { FileOp } from './validation/validate-file.js';
import { applyOps, validateProject, type Tree } from './validation/validate-project.js';

export type Termination = 'completed' | 'cancelled' | 'disconnected' | 'timeout' | 'provider_error';
export interface RejectedFile {
  path: string;
  issues: Issue[];
}

export interface OutcomeInput {
  termination: Termination;
  providerErrorCode?: ErrorCode;
  stopReason: string | null;
  ops: readonly FileOp[];
  rejected: readonly RejectedFile[];
  aborted: readonly RejectedFile[];
  currentTree: Tree | null;
}

export type Decision =
  | { kind: 'commit'; warnings: Issue[] }
  | {
      kind: 'fail';
      status: 'failed' | 'interrupted';
      error: GenerationError | null;
      partial: PartialResult | null;
      issues?: Issue[];
    };

const err = (code: ErrorCode, message = defaultMessage(code)): GenerationError => ({
  code,
  message,
  retryable: isRetryable(code),
});

function partialOf(i: OutcomeInput): PartialResult | null {
  const stagedPaths = i.ops
    .filter((o) => o.op === 'write')
    .map((o) => o.path)
    .sort();
  if (stagedPaths.length === 0 || !i.currentTree)
    return stagedPaths.length ? { stagedPaths, applyable: false } : null;
  const valid = validateProject(applyOps(i.currentTree, i.ops)).every(
    (x) => x.severity !== 'error',
  );
  return { stagedPaths, applyable: valid };
}

export function decideOutcome(i: OutcomeInput): Decision {
  switch (i.termination) {
    case 'disconnected':
      return {
        kind: 'fail',
        status: 'interrupted',
        error: err('GENERATION_INTERRUPTED'),
        partial: partialOf(i),
      };
    case 'timeout':
      return {
        kind: 'fail',
        status: 'failed',
        error: err('GENERATION_TIMEOUT'),
        partial: partialOf(i),
      };
    case 'provider_error':
      return {
        kind: 'fail',
        status: 'failed',
        error: err(i.providerErrorCode ?? 'INTERNAL'),
        partial: partialOf(i),
      };
    case 'completed':
      break;
  }
  if (i.stopReason === 'refusal')
    return {
      kind: 'fail',
      status: 'failed',
      error: err('GENERATION_REFUSED'),
      partial: null,
    };
  if (i.stopReason === 'model_context_window_exceeded')
    return {
      kind: 'fail',
      status: 'failed',
      error: err('CONTEXT_TOO_LARGE'),
      partial: null,
    };

  const bad = [...i.rejected, ...i.aborted];
  if (i.ops.length === 0) {
    if (bad.length === 0 && i.stopReason !== 'max_tokens') return { kind: 'commit', warnings: [] };
    const code: ErrorCode =
      i.stopReason === 'max_tokens' ? 'GENERATION_TRUNCATED' : 'GENERATION_INVALID_OUTPUT';
    return {
      kind: 'fail',
      status: 'failed',
      error: err(code),
      partial: null,
      issues: bad.flatMap((b) => b.issues),
    };
  }

  const tree = i.currentTree ?? new Map();
  const projectIssues = validateProject(applyOps(tree, i.ops));
  const errors = projectIssues.filter((x) => x.severity === 'error');
  if (errors.length > 0) {
    const code: ErrorCode =
      i.stopReason === 'max_tokens' ? 'GENERATION_TRUNCATED' : 'GENERATION_INVALID_OUTPUT';
    return {
      kind: 'fail',
      status: 'failed',
      error: err(
        code,
        `${defaultMessage(code)} ${errors.map((e) => e.message).join(' ')}`.slice(0, 500),
      ),
      partial: {
        stagedPaths: i.ops
          .filter((o) => o.op === 'write')
          .map((o) => o.path)
          .sort(),
        applyable: false,
      },
      issues: [...errors, ...bad.flatMap((b) => b.issues)],
    };
  }
  const warnings = projectIssues.filter((x) => x.severity === 'warning');
  if (i.stopReason === 'max_tokens')
    warnings.push({
      code: 'TRUNCATED',
      severity: 'warning',
      message: 'The response hit the length limit; unfinished files were skipped.',
    });
  return { kind: 'commit', warnings };
}
```

- [ ] **Step 3: Implement `orchestrator.ts`**

```ts
import type { Request, Response } from 'express';
import type { Issue, Usage } from '../../contracts/firestore-docs.js';
import { LIMITS } from '../../contracts/limits.js';
import { languageForPath } from '../../contracts/paths.js';
import type { Clock } from '../../shared/clock.js';
import { sha256Hex, utf8Bytes } from '../../shared/hash.js';
import { serializeError, type Logger } from '../../shared/logger.js';
import type { ContextBuilder } from './context/context-builder.js';
import type { CurrentFile } from './context/render-context.js';
import {
  estimateCostUsd,
  ProviderError,
  type ModelProvider,
  type ProviderResult,
} from './llm/model-provider.js';
import { decideOutcome, type Decision, type RejectedFile, type Termination } from './outcome.js';
import type { CommitService } from './persistence/commit.service.js';
import type { GenerationsRepo } from './persistence/generations.repo.js';
import { PROMPT_VERSION } from './prompt/system-prompt.v1.js';
import { FileStreamParser, type ParserEvent } from './protocol/file-stream-parser.js';
import { SseWriter } from './sse/sse-writer.js';
import { validateDelete, validateWrite, type FileOp } from './validation/validate-file.js';
import type { Tree } from './validation/validate-project.js';

class GenerationAbort extends Error {
  constructor(readonly kind: 'cancelled' | 'disconnected' | 'timeout') {
    super(kind);
    this.name = 'GenerationAbort';
  }
}

export interface OrchestratorDeps {
  generations: GenerationsRepo;
  commits: CommitService;
  context: ContextBuilder;
  provider: ModelProvider;
  clock: Clock;
  deadlineMs?: number;
  heartbeatMs?: number;
}

export interface RunInput {
  uid: string;
  projectId: string;
  generationId: string;
  prompt: string;
}

/** Mutable per-run state. */
class RunState {
  prose = '';
  raw = '';
  firstTokenAtMs: number | null = null;
  readonly ops = new Map<string, FileOp>();
  readonly rejected: RejectedFile[] = [];
  readonly aborted: RejectedFile[] = [];
  readonly warnings: Issue[] = [];
  readonly suppressed = new Set<string>();
  currentTree: Tree | null = null;
  currentFiles: Map<string, CurrentFile> | null = null;
  stats: {
    fileCount: number;
    historyMessages: number;
    externalIncluded: boolean;
    promptChars: number;
  } | null = null;
}

const toTree = (files: Map<string, CurrentFile>): Tree =>
  new Map(
    [...files.values()].map((f) => [
      f.path,
      {
        path: f.path,
        content: f.content,
        sizeBytes: f.sizeBytes,
        sha256: f.contentHash,
        language: f.language,
      },
    ]),
  );

export class GenerationOrchestrator {
  constructor(private readonly d: OrchestratorDeps) {}

  /** Throws AppError before the stream opens (→ JSON error); never throws after. */
  async run(req: Request, res: Response, i: RunInput): Promise<void> {
    const { clock, provider, generations } = this.d;
    const log = req.ctx.log.child({
      projectId: i.projectId,
      generationId: i.generationId,
    });
    const startedAt = clock.now();
    const { project, projectDescription } = await generations.start({
      ...i,
      promptVersion: PROMPT_VERSION,
      model: provider.model,
      effort: provider.effort,
      nowMs: startedAt,
    });

    const sse = new SseWriter(res, i.generationId, clock);
    sse.open();
    sse.send('generation.started', {
      projectId: i.projectId,
      model: provider.model,
      promptVersion: PROMPT_VERSION,
      startedAt: new Date(startedAt).toISOString(),
    });
    log.info('generation.start', { promptChars: i.prompt.length });

    const state = new RunState();
    const abort = new AbortController();
    let terminalSent = false;
    const stopWatch = generations.watchCancel(
      i.uid,
      i.projectId,
      i.generationId,
      () => abort.abort(new GenerationAbort('cancelled')),
      (err) =>
        log.warn('generation.cancel_watch_failed', {
          error: serializeError(err),
        }),
    );
    const onClose = () => {
      if (!terminalSent) abort.abort(new GenerationAbort('disconnected'));
    };
    res.on('close', onClose);
    const heartbeat = setInterval(() => {
      sse.heartbeat();
      generations.touch(i.uid, i.projectId, i.generationId, clock.now()).catch((err: unknown) =>
        log.warn('generation.heartbeat_failed', {
          error: serializeError(err),
        }),
      );
    }, this.d.heartbeatMs ?? LIMITS.heartbeatMs);
    const deadline = setTimeout(
      () => abort.abort(new GenerationAbort('timeout')),
      this.d.deadlineMs ?? LIMITS.generationDeadlineMs,
    );

    let final: ProviderResult | null = null;
    let termination: Termination = 'completed';
    let providerErrorCode: ProviderError['code'] | undefined;

    try {
      sse.send('generation.phase', { phase: 'context' });
      const ctx = await this.d.context.build({
        uid: i.uid,
        projectId: i.projectId,
        projectName: project.name,
        projectDescription,
        generationId: i.generationId,
        prompt: i.prompt,
      });
      state.currentFiles = ctx.currentFiles;
      state.currentTree = toTree(ctx.currentFiles);
      state.stats = ctx.stats;

      sse.send('generation.phase', { phase: 'thinking' });
      const stream = provider.stream({
        system: ctx.system,
        messages: ctx.messages,
        signal: abort.signal,
      });
      const parser = new FileStreamParser();
      let writing = false;
      for await (const ev of stream) {
        state.firstTokenAtMs ??= clock.now();
        if (ev.type === 'thinking_delta') {
          sse.send('assistant.thinking', { text: ev.text });
          continue;
        }
        if (!writing) {
          writing = true;
          sse.send('generation.phase', { phase: 'writing' });
        }
        state.raw += ev.text;
        for (const pe of parser.push(ev.text)) await this.onParserEvent(pe, sse, state, i, log);
        await sse.drain();
      }
      for (const pe of parser.finish()) await this.onParserEvent(pe, sse, state, i, log);
      final = await stream.final();
    } catch (err) {
      const reason: unknown = abort.signal.reason;
      if (abort.signal.aborted && reason instanceof GenerationAbort) termination = reason.kind;
      else if (err instanceof ProviderError) {
        termination = 'provider_error';
        providerErrorCode = err.code;
      } else {
        termination = 'provider_error';
        providerErrorCode = 'INTERNAL';
        log.error('generation.unexpected', { error: serializeError(err) });
      }
    }

    try {
      if (termination === 'completed') sse.send('generation.phase', { phase: 'validating' });
      const decision = decideOutcome({
        termination,
        providerErrorCode,
        stopReason: final?.stopReason ?? null,
        ops: [...state.ops.values()],
        rejected: state.rejected,
        aborted: state.aborted,
        currentTree: state.currentTree,
      });
      terminalSent = true; // from here, a close is expected
      await this.finish(decision, sse, state, i, startedAt, final, termination, log);
    } catch (err) {
      log.error('generation.finalize_failed', { error: serializeError(err) });
      if (!sse.isClosed) {
        const partial = state.ops.size
          ? { stagedPaths: [...state.ops.keys()].sort(), applyable: false }
          : null;
        sse.send('generation.failed', {
          error: {
            code: 'INTERNAL',
            message: 'Saving the generation failed. Please try again.',
            retryable: true,
          },
          partial,
        });
      }
    } finally {
      clearInterval(heartbeat);
      clearTimeout(deadline);
      stopWatch();
      res.off('close', onClose);
      await generations
        .saveRawArtifact(i.uid, i.projectId, i.generationId, state.raw, clock.now())
        .catch((err: unknown) =>
          log.warn('generation.raw_save_failed', {
            error: serializeError(err),
          }),
        );
      sse.end();
    }
  }

  private async onParserEvent(
    pe: ParserEvent,
    sse: SseWriter,
    s: RunState,
    i: RunInput,
    log: Logger,
  ): Promise<void> {
    switch (pe.type) {
      case 'prose':
        s.prose += pe.text;
        sse.send('assistant.delta', { text: pe.text });
        return;
      case 'file_start': {
        const language = languageForPath(pe.path);
        if (!language) {
          s.suppressed.add(pe.path);
          return;
        }
        sse.send('file.started', { path: pe.path, language, op: 'write' });
        return;
      }
      case 'file_chunk':
        if (!s.suppressed.has(pe.path)) sse.send('file.delta', { path: pe.path, text: pe.text });
        return;
      case 'file_end': {
        const v = validateWrite(pe.path, pe.content);
        const warnings = v.issues.filter((x) => x.severity === 'warning');
        if (v.op) {
          s.ops.set(v.op.path, v.op);
          s.warnings.push(...warnings);
          await this.d.generations.stage(
            i.uid,
            i.projectId,
            i.generationId,
            v.op,
            warnings,
            this.d.clock.now(),
          );
        } else {
          s.rejected.push({ path: pe.path, issues: v.issues });
        }
        sse.send('file.completed', {
          path: pe.path,
          status: v.op ? 'valid' : 'rejected',
          sizeBytes: utf8Bytes(pe.content),
          sha256: sha256Hex(pe.content),
          issues: v.issues,
        });
        return;
      }
      case 'file_delete': {
        const existing = new Set([...(s.currentFiles?.keys() ?? []), ...s.ops.keys()]);
        const v = validateDelete(pe.path, existing);
        if (v.op) {
          s.ops.set(pe.path, v.op);
          await this.d.generations.stage(
            i.uid,
            i.projectId,
            i.generationId,
            v.op,
            [],
            this.d.clock.now(),
          );
        } else if (!v.ok) {
          s.rejected.push({ path: pe.path, issues: v.issues });
        } else {
          s.warnings.push(...v.issues);
        }
        sse.send('file.deleted', {
          path: pe.path,
          status: v.ok ? 'valid' : 'rejected',
          issues: v.issues,
        });
        return;
      }
      case 'file_abort': {
        const issues: Issue[] = [
          {
            code: 'FILE_UNTERMINATED',
            severity: 'error',
            message: 'The file was cut off before it finished.',
            path: pe.path,
          },
        ];
        s.aborted.push({ path: pe.path, issues });
        if (!s.suppressed.has(pe.path)) {
          sse.send('file.completed', {
            path: pe.path,
            status: 'rejected',
            sizeBytes: utf8Bytes(pe.content),
            sha256: sha256Hex(pe.content),
            issues,
          });
        }
        return;
      }
      case 'protocol_warning':
        log.warn('generation.protocol_warning', { code: pe.code });
        return;
    }
  }

  private async finish(
    decision: Decision,
    sse: SseWriter,
    s: RunState,
    i: RunInput,
    startedAt: number,
    final: ProviderResult | null,
    termination: Termination,
    log: Logger,
  ): Promise<void> {
    const now = this.d.clock.now();
    const usage: Usage | null = final
      ? { ...final.usage, costUsd: estimateCostUsd(final.model, final.usage) }
      : null;
    const timings = {
      ttftMs: s.firstTokenAtMs ? s.firstTokenAtMs - startedAt : null,
      totalMs: now - startedAt,
    };
    const rejected = [...s.rejected, ...s.aborted];

    if (decision.kind === 'commit') {
      sse.send('generation.phase', { phase: 'committing' });
      const assistantText =
        s.prose.trim() ||
        (s.ops.size ? `Updated ${s.ops.size} file(s).` : 'No file changes were needed.');
      const result = await this.d.commits.applyTreeChange({
        uid: i.uid,
        projectId: i.projectId,
        nowMs: now,
        ops: [...s.ops.values()],
        source: 'ai',
        validateNextTree: true,
        snapshot: {
          kind: 'generation',
          label: i.prompt,
          generationId: i.generationId,
          restoredFromSnapshotId: null,
        },
        lease: { mode: 'must-hold', generationId: i.generationId },
        messages: [
          {
            role: 'assistant',
            content: assistantText,
            generationId: i.generationId,
            meta: {
              status: 'completed',
              rejectedPaths: rejected.map((r) => r.path),
            },
          },
        ],
        generationPatch: {
          generationId: i.generationId,
          build: (r) => ({
            status: 'completed',
            completedAt: new Date(now),
            stopReason: final?.stopReason ?? null,
            error: null,
            partial: null,
            usage,
            timings,
            ...(s.stats ? { context: s.stats } : {}),
            result: {
              snapshotId: r.snapshotId,
              snapshotSeq: r.snapshotSeq,
              changedPaths: r.changedPaths,
              deletedPaths: r.deletedPaths,
              rejected,
              warnings: [...s.warnings, ...decision.warnings],
              noChanges: r.noChanges,
            },
          }),
        },
      });
      sse.send('generation.completed', {
        snapshotId: result.snapshotId,
        snapshotSeq: result.snapshotSeq,
        changedPaths: result.changedPaths,
        deletedPaths: result.deletedPaths,
        rejected,
        warnings: [...s.warnings, ...decision.warnings],
        noChanges: result.noChanges,
        usage: usage ?? {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUsd: 0,
        },
        durationMs: timings.totalMs,
      });
      log.info('generation.complete', {
        model: final?.model,
        stopReason: final?.stopReason,
        changed: result.changedPaths.length,
        ...usage,
        ...timings,
      });
      return;
    }

    const statusNote = {
      interrupted: '(Connection lost during generation.)',
      failed: `(Generation failed: ${decision.error?.message ?? 'unknown error'})`,
    }[decision.status];
    await this.d.generations.finalizeWithoutCommit({
      uid: i.uid,
      projectId: i.projectId,
      generationId: i.generationId,
      nowMs: now,
      status: decision.status,
      error: decision.error,
      partial: decision.partial,
      stopReason: final?.stopReason ?? null,
      usage,
      timings,
      context: s.stats,
      assistantText: `${s.prose.trim()}\n\n${statusNote}`.trim(),
    });
    log.info('generation.end', {
      status: decision.status,
      code: decision.error?.code,
      termination,
    });
    if (termination === 'disconnected') return; // nobody is listening
    sse.send('generation.failed', {
      error: decision.error ?? {
        code: 'INTERNAL',
        message: 'Generation failed.',
        retryable: true,
      },
      partial: decision.partial,
    });
  }
}
```

> The message meta written by `applyTreeChange` automatically receives `snapshotId`, `snapshotSeq`, `changedPaths` and `deletedPaths` (the chat's "Changed app.js · Version #4" line reads them).
>
> Note on `completedAt: new Date(now)`: the Admin SDK stores JS `Date` as a Firestore `Timestamp`.

- [ ] **Step 4: Run unit tests → PASS; commit** — `feat(functions): add outcome decisions and the generation orchestrator`.

---

### Task BE-6.6: `generate` function app

**Files:**

- Create: `functions/src/modules/generation/generate.app.ts`
- Modify: `functions/src/composition.ts`

**Interfaces:**

- Produces: `generationRouter({ orchestrator, limiter, config })` with `POST /v1/projects/:projectId/generations`.

- [ ] **Step 1: Implement**

```ts
import express, { type Router } from 'express';
import { ProjectParams, StartGenerationBody } from '../../contracts/api.js';
import type { RuntimeConfig } from '../../config/runtime-config.js';
import { defineHandler, requireUid } from '../../http/define-handler.js';
import { rateLimit } from '../../http/middleware/rate-limit.js';
import { AppError } from '../../shared/app-error.js';
import { globalGenerationRule, RATE_LIMITS, type RateLimiter } from '../rate-limit/rate-limiter.js';
import type { GenerationOrchestrator } from './orchestrator.js';

export function generationRouter(d: {
  orchestrator: GenerationOrchestrator;
  limiter: RateLimiter;
  config: Pick<RuntimeConfig, 'generationEnabled' | 'generationDailyGlobalCap'>;
}): Router {
  const r = express.Router();
  r.post(
    '/v1/projects/:projectId/generations',
    (_req, _res, next) => {
      if (!d.config.generationEnabled) throw new AppError('GENERATION_DISABLED');
      next();
    },
    rateLimit(d.limiter, RATE_LIMITS.generationHour),
    rateLimit(d.limiter, RATE_LIMITS.generationDay),
    rateLimit(d.limiter, globalGenerationRule(d.config.generationDailyGlobalCap), () => 'global'),
    defineHandler(
      { params: ProjectParams, body: StartGenerationBody },
      async ({ params, body }, req, res) => {
        await d.orchestrator.run(req, res, {
          uid: requireUid(req),
          projectId: params.projectId,
          generationId: body.clientRequestId,
          prompt: body.prompt,
        });
      },
    ),
  );
  return r;
}
```

- [ ] **Step 2: Wire `buildGenerateApp` in `composition.ts`**

```ts
function buildGenerateApp(config: RuntimeConfig): Express {
  const logger = createLogger({ service: 'generate' });
  const db = firestore();
  const clock = systemClock;
  const secrets = loadSecrets({
    anthropic: config.llmProvider === 'anthropic',
  });
  const cipher = createTokenCipher(secrets.tokenEncryptionKey);
  const connections = new FirestoreConnectionRepo(db);
  const tokenEndpoint = createTokenEndpointClient({
    baseUrl: config.hlApiBaseUrl,
    clientId: secrets.hlClientId,
    clientSecret: secrets.hlClientSecret,
    redirectUri: config.hlRedirectUri,
  });
  const tokens = new TokenManager({
    repo: connections,
    tokens: tokenEndpoint,
    cipher,
    clock,
    logger,
  });
  const hl = createHlHttpClient({
    baseUrl: config.hlApiBaseUrl,
    limiter: new LocationRateLimiter(clock),
    logger: logger.child({ component: 'hl' }),
  });
  const locationContext = new LocationContextService({
    connections,
    tokens,
    hl,
    clock,
    logger,
  });
  const provider: ModelProvider =
    config.llmProvider === 'fake'
      ? new FakeProvider({ chunkDelayMs: 15 })
      : new AnthropicProvider(
          new Anthropic({
            apiKey: secrets.anthropicApiKey ?? '',
            maxRetries: 2,
            timeout: 600_000,
          }),
          {
            model: config.anthropicModel,
            effort: config.anthropicEffort,
            maxTokens: LIMITS.maxOutputTokens,
            fastMode: config.anthropicFastMode,
          },
        );
  const orchestrator = new GenerationOrchestrator({
    generations: new GenerationsRepo(db),
    commits: new CommitService(db, new BlobsRepo(db)),
    context: new ContextBuilder(db, locationContext),
    provider,
    clock,
  });
  const publicRouters: Router[] = config.sseSmokeEnabled ? [sseSmokeRouter()] : [];
  const authedRouters: Router[] = [
    generationRouter({
      orchestrator,
      limiter: new FirestoreRateLimiter(db, clock),
      config,
    }),
  ];
  return createHttpApp({
    service: 'generate',
    version: VERSION,
    allowedOrigins: config.allowedOrigins,
    logger,
    verifyIdToken,
    publicRouters,
    authedRouters,
  });
}
```

- [ ] **Step 3: Emulator smoke** — `LLM_PROVIDER=fake` in `functions/.env.local`; `firebase emulators:start`; get an ID token for an emulator user and a project ID (FE-2 or the Emulator UI), then:

```bash
curl -N -X POST "http://127.0.0.1:5001/genesis-builder-7f3a/us-central1/generate/v1/projects/$PID/generations" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "Accept: text/event-stream" \
  -d "{\"clientRequestId\":\"$(uuidgen | tr A-Z a-z)\",\"prompt\":\"Build a contact dashboard\"}"
```

Expected: `generation.started` → `phase:context` → `phase:thinking` → `assistant.thinking` → `phase:writing` → `assistant.delta`… → `file.started index.html` → many `file.delta` → `file.completed valid` ×3 → `phase:validating` → `phase:committing` → `generation.completed` (snapshotSeq 1).

- [ ] **Step 4: Commit** — `feat(functions): expose SSE generation endpoint on the generate function`.

---

### Task BE-6.7: Apply and discard routes (api function)

**Files:**

- Create: `functions/src/modules/generation/routes/generation-control.routes.ts`
- Modify: `functions/src/composition.ts`

**Interfaces:**

- Produces: `generationControlRouter({ generations, commits, clock })` → A14 apply, A15 discard, and `POST …/cancel` (R-B1).

- [ ] **Step 1: Implement**

```ts
import express, { type Router } from 'express';
import { GenerationParams } from '../../../contracts/api.js';
import { defineHandler, requireUid } from '../../../http/define-handler.js';
import { sendData } from '../../../http/respond.js';
import { AppError } from '../../../shared/app-error.js';
import type { Clock } from '../../../shared/clock.js';
import type { CommitService } from '../persistence/commit.service.js';
import type { GenerationsRepo } from '../persistence/generations.repo.js';

export function generationControlRouter(d: {
  generations: GenerationsRepo;
  commits: CommitService;
  clock: Clock;
}): Router {
  const r = express.Router();
  const base = '/v1/projects/:projectId/generations/:generationId';

  r.post(
    `${base}/apply`,
    defineHandler({ params: GenerationParams }, async ({ params }, req, res) => {
      const uid = requireUid(req);
      const gen = await d.generations.get(uid, params.projectId, params.generationId);
      if (!gen) throw new AppError('GENERATION_NOT_FOUND');
      if (gen.status === 'streaming') throw new AppError('GENERATION_IN_PROGRESS');
      if (!gen.partial?.applyable || gen.partial.applied || gen.partial.discarded)
        throw new AppError('GENERATION_NOT_APPLYABLE');
      const ops = await d.generations.listStaged(uid, params.projectId, params.generationId);
      if (ops.length === 0) throw new AppError('GENERATION_NOT_APPLYABLE');
      const now = d.clock.now();
      const result = await d.commits.applyTreeChange({
        uid,
        projectId: params.projectId,
        nowMs: now,
        ops,
        source: 'ai',
        validateNextTree: true,
        snapshot: {
          kind: 'generation',
          label: `Partial: ${gen.prompt}`,
          generationId: params.generationId,
          restoredFromSnapshotId: null,
        },
        lease: { mode: 'must-be-free' },
        messages: [
          {
            role: 'system',
            content: `Applied ${ops.length} file(s) from an unfinished generation.`,
            generationId: params.generationId,
            meta: null,
          },
        ],
        generationPatch: {
          generationId: params.generationId,
          build: (c) => ({
            'partial.appliedAt': new Date(now),
            'partial.appliedSnapshotId': c.snapshotId,
          }),
        },
      });
      sendData(res, {
        snapshotId: result.snapshotId,
        snapshotSeq: result.snapshotSeq,
        appliedPaths: ops.filter((o) => o.op === 'write').map((o) => o.path),
        deletedPaths: result.deletedPaths,
      });
    }),
  );

  r.post(
    `${base}/discard`,
    defineHandler({ params: GenerationParams }, async ({ params }, req, res) => {
      await d.generations.markDiscarded(
        requireUid(req),
        params.projectId,
        params.generationId,
        d.clock.now(),
      );
      sendData(res, { discarded: true as const });
    }),
  );

  return r;
}
```

- [ ] **Step 2: Wire into `buildApiApp`**: `authedRouters.push(generationControlRouter({ generations: new GenerationsRepo(db), commits: new CommitService(db, new BlobsRepo(db)), clock }));`

- [ ] **Step 3: Commit** — `feat(functions): add apply-partial and discard endpoints`.

### Task BE-6.8: Generation scenario matrix (integration, emulator)

**Files:**

- Create: `functions/test/helpers/generation-harness.ts`, `functions/test/integration/generation/scenarios.test.ts`

**Interfaces:** Consumes everything above with `FakeProvider` (no delays unless the scenario needs them), real Firestore emulator, real repositories; auth stub `verifyIdToken = (t) => ({ uid: t })`.

- [ ] **Step 1: Harness**

```ts
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Timestamp } from 'firebase-admin/firestore';
import request from 'supertest';
import { createHttpApp } from '../../src/http/create-http-app.js';
import { generationRouter } from '../../src/modules/generation/generate.app.js';
import { GenerationOrchestrator } from '../../src/modules/generation/orchestrator.js';
import { ContextBuilder } from '../../src/modules/generation/context/context-builder.js';
import { FakeProvider } from '../../src/modules/generation/llm/fake.provider.js';
import { CommitService } from '../../src/modules/generation/persistence/commit.service.js';
import { GenerationsRepo } from '../../src/modules/generation/persistence/generations.repo.js';
import { generationControlRouter } from '../../src/modules/generation/routes/generation-control.routes.js';
import { MemoryRateLimiter } from '../../src/modules/rate-limit/rate-limiter.js';
import { BlobsRepo } from '../../src/modules/snapshots/blobs.repo.js';
import { systemClock } from '../../src/shared/clock.js';
import { firestore } from '../../src/shared/firebase-admin.js';
import { fakeLogger } from './fakes.js';
import { parseSse } from './parse-sse.js';

export const db = firestore();

export function makeApps(opts: { deadlineMs?: number; chunkDelayMs?: number } = {}) {
  const generations = new GenerationsRepo(db);
  const commits = new CommitService(db, new BlobsRepo(db));
  const locationContext = {
    getContext: () =>
      Promise.resolve({
        status: 'disconnected' as const,
        locationName: null,
        timezone: null,
        calendars: [],
        contactsTotal: null,
        availableMethods: [],
        note: 'HighLevel is not connected yet.',
      }),
  };
  const orchestrator = new GenerationOrchestrator({
    generations,
    commits,
    context: new ContextBuilder(db, locationContext),
    provider: new FakeProvider({ chunkDelayMs: opts.chunkDelayMs ?? 0 }),
    clock: systemClock,
    deadlineMs: opts.deadlineMs,
    heartbeatMs: 1_000,
  });
  const limiter = new MemoryRateLimiter(systemClock);
  const common = {
    version: 't',
    allowedOrigins: [],
    logger: fakeLogger(),
    verifyIdToken: (t: string) => Promise.resolve({ uid: t }),
  };
  const generate = createHttpApp({
    ...common,
    service: 'generate',
    authedRouters: [
      generationRouter({
        orchestrator,
        limiter,
        config: { generationEnabled: true, generationDailyGlobalCap: 10_000 },
      }),
    ],
  });
  const api = createHttpApp({
    ...common,
    service: 'api',
    authedRouters: [
      generationControlRouter({
        generations,
        commits,
        limiter,
        clock: systemClock,
      }),
    ],
  });
  return { generate, api };
}

export async function seedProject(uid: string, pid: string, extra: Record<string, unknown> = {}) {
  const now = Timestamp.now();
  await db.doc(`users/${uid}/projects/${pid}`).set({
    name: 'Demo',
    description: '',
    locationId: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...extra,
  });
}

export async function generate(
  app: http.RequestListener | ReturnType<typeof makeApps>['generate'],
  uid: string,
  pid: string,
  prompt: string,
  id = crypto.randomUUID(),
) {
  const res = await request(app)
    .post(`/v1/projects/${pid}/generations`)
    .set('Authorization', `Bearer ${uid}`)
    .set('Accept', 'text/event-stream')
    .send({ clientRequestId: id, prompt });
  const frames = res.headers['content-type']?.includes('text/event-stream')
    ? parseSse(res.text)
    : [];
  return {
    res,
    id,
    frames,
    types: frames.map((f) => f.event),
    last: frames.at(-1)?.data as { type: string; data: Record<string, unknown> } | undefined,
  };
}

export async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Starts a real HTTP server so a test can disconnect mid-stream. */
export async function startAndDisconnect(
  app: ReturnType<typeof makeApps>['generate'],
  uid: string,
  pid: string,
  prompt: string,
  afterBytes = 2_000,
) {
  const server = http.createServer(app).listen(0);
  const port = (server.address() as AddressInfo).port;
  const id = crypto.randomUUID();
  await new Promise<void>((resolve) => {
    const req = http.request(
      {
        port,
        method: 'POST',
        path: `/v1/projects/${pid}/generations`,
        headers: {
          Authorization: `Bearer ${uid}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
      },
      (res) => {
        let n = 0;
        res.on('data', (c: Buffer) => {
          n += c.length;
          if (n > afterBytes) {
            req.destroy();
            resolve();
          }
        });
      },
    );
    req.end(JSON.stringify({ clientRequestId: id, prompt }));
  });
  return { id, close: () => new Promise<void>((r) => server.close(() => r())) };
}
```

- [ ] **Step 2: Scenarios**

```ts
import { Timestamp } from 'firebase-admin/firestore';
import request from 'supertest';
import {
  db,
  generate,
  makeApps,
  seedProject,
  startAndDisconnect,
  waitFor,
} from '../../helpers/generation-harness.js';

const gen = (uid: string, pid: string, id: string) =>
  db.doc(`users/${uid}/projects/${pid}/generations/${id}`).get();
const project = (uid: string, pid: string) => db.doc(`users/${uid}/projects/${pid}`).get();
const files = async (uid: string, pid: string) =>
  (await db.collection(`users/${uid}/projects/${pid}/files`).get()).docs
    .map((d) => d.get('path') as string)
    .sort();

describe('generation scenarios', () => {
  const { generate: app, api } = makeApps();

  it('1 first generation streams, commits and snapshots', async () => {
    await seedProject('u1', 'p');
    const r = await generate(app, 'u1', 'p', 'Build a contact dashboard');
    expect(r.types[0]).toBe('generation.started');
    expect(r.types).toEqual(
      expect.arrayContaining([
        'assistant.thinking',
        'assistant.delta',
        'file.started',
        'file.delta',
        'file.completed',
      ]),
    );
    expect(r.last).toMatchObject({
      type: 'generation.completed',
      data: {
        snapshotSeq: 1,
        changedPaths: ['app.js', 'index.html', 'styles.css'],
      },
    });
    const seqs = r.frames.map((f) => (f.data as { seq: number }).seq);
    expect(seqs).toEqual(seqs.map((_, k) => k + 1));
    expect(await files('u1', 'p')).toEqual(['app.js', 'index.html', 'styles.css']);
    expect((await gen('u1', 'p', r.id)).get('status')).toBe('completed');
    expect((await project('u1', 'p')).get('activeGeneration')).toBeNull();
    const roles = (
      await db.collection('users/u1/projects/p/messages').orderBy('createdAt').get()
    ).docs.map((d) => d.get('role'));
    expect(roles).toEqual(['user', 'assistant']);
  });

  it('2 refinement changes one file and reuses blobs', async () => {
    const r = await generate(app, 'u1', 'p', 'Rename the title #refine');
    expect(r.last).toMatchObject({
      type: 'generation.completed',
      data: { snapshotSeq: 2, changedPaths: ['index.html'] },
    });
  });

  it('3 a question commits a no-op snapshot', async () => {
    const r = await generate(app, 'u1', 'p', 'What does this do? #question');
    expect(r.last).toMatchObject({
      type: 'generation.completed',
      data: { noChanges: true, snapshotSeq: 3 },
    });
  });

  it('4 an invalid extra file is rejected but the project commits', async () => {
    await seedProject('u2', 'p');
    const r = await generate(app, 'u2', 'p', 'Dashboard #extra-invalid');
    expect(r.last).toMatchObject({
      type: 'generation.completed',
      data: { rejected: [{ path: 'NOTES.md' }] },
    });
  });

  it('5 a reference to a rejected file fails and commits nothing (raw saved)', async () => {
    await seedProject('u3', 'p');
    const r = await generate(app, 'u3', 'p', 'Dashboard #badjs');
    expect(r.last).toMatchObject({
      type: 'generation.failed',
      data: {
        error: { code: 'GENERATION_INVALID_OUTPUT' },
        partial: { applyable: false },
      },
    });
    expect(await files('u3', 'p')).toEqual([]);
    expect(
      (await db.doc(`users/u3/projects/p/generations/${r.id}/artifacts/raw`).get()).get('text'),
    ).toContain('⟦FILE');
  });

  it('6 max_tokens mid-file fails as truncated on an empty project', async () => {
    await seedProject('u4', 'p');
    const r = await generate(app, 'u4', 'p', 'Dashboard #truncate');
    expect(r.last).toMatchObject({
      type: 'generation.failed',
      data: { error: { code: 'GENERATION_TRUNCATED' } },
    });
    expect(
      r.frames.some((f) =>
        (f.data as { data: { issues?: { code: string }[] } }).data.issues?.some(
          (x) => x.code === 'FILE_UNTERMINATED',
        ),
      ),
    ).toBe(true);
  });

  it('7 provider error after one file keeps an applyable partial that can be applied', async () => {
    const r = await generate(app, 'u1', 'p', 'Refine #error');
    expect(r.last).toMatchObject({
      type: 'generation.failed',
      data: {
        error: { code: 'LLM_UNAVAILABLE', retryable: true },
        partial: { stagedPaths: ['index.html'], applyable: true },
      },
    });
    const applied = await request(api)
      .post(`/v1/projects/p/generations/${r.id}/apply`)
      .set('Authorization', 'Bearer u1');
    expect(applied.status).toBe(200);
    expect(applied.body.data.appliedPaths).toEqual(['index.html']);
    const again = await request(api)
      .post(`/v1/projects/p/generations/${r.id}/apply`)
      .set('Authorization', 'Bearer u1');
    expect(again.body.error.code).toBe('GENERATION_NOT_APPLYABLE');
  });

  it('8 client disconnect finalizes as interrupted', async () => {
    const slow = makeApps({ chunkDelayMs: 30 });
    await seedProject('u6', 'p');
    const run = await startAndDisconnect(slow.generate, 'u6', 'p', 'x #slow');
    const status = await waitFor(async () => {
      const s = (await gen('u6', 'p', run.id)).get('status') as string;
      return s === 'streaming' ? undefined : s;
    });
    expect(status).toBe('interrupted');
    expect((await project('u6', 'p')).get('activeGeneration')).toBeNull();
    await run.close();
  });

  it('10 a second start while one is running is rejected', async () => {
    const now = Timestamp.now();
    await seedProject('u7', 'p', {
      activeGeneration: { id: 'live', startedAt: now, heartbeatAt: now },
    });
    const r = await generate(app, 'u7', 'p', 'x');
    expect(r.res.status).toBe(409);
    expect(r.res.body.error).toMatchObject({
      code: 'GENERATION_IN_PROGRESS',
      details: { activeGenerationId: 'live' },
    });
  });

  it('11 duplicate clientRequestId is rejected', async () => {
    await seedProject('u8', 'p');
    const first = await generate(app, 'u8', 'p', 'x #question');
    const dup = await generate(app, 'u8', 'p', 'x #question', first.id);
    expect(dup.res.status).toBe(409);
    expect(dup.res.body.error.code).toBe('DUPLICATE_REQUEST');
  });

  it('12 a stale lease is taken over and the old generation marked interrupted', async () => {
    const old = Timestamp.fromMillis(Date.now() - 120_000);
    await seedProject('u9', 'p', {
      activeGeneration: { id: 'old', startedAt: old, heartbeatAt: old },
    });
    await db
      .doc('users/u9/projects/p/generations/old')
      .set({ status: 'streaming', prompt: 'x', heartbeatAt: old });
    const r = await generate(app, 'u9', 'p', 'Dashboard');
    expect(r.last?.type).toBe('generation.completed');
    expect((await gen('u9', 'p', 'old')).get('status')).toBe('interrupted');
  });

  it('13 a dirty tree gets a checkpoint snapshot before the new one', async () => {
    await db.doc('users/u1/projects/p').update({ workingTreeDirty: true });
    const before = (await project('u1', 'p')).get('snapshotSeq') as number;
    const r = await generate(app, 'u1', 'p', 'Rename again #refine');
    expect(r.last).toMatchObject({
      type: 'generation.completed',
      data: { snapshotSeq: before + 2 },
    });
    const kinds = (
      await db.collection('users/u1/projects/p/snapshots').orderBy('seq', 'desc').limit(2).get()
    ).docs.map((d) => d.get('kind'));
    expect(kinds).toEqual(['generation', 'checkpoint']);
  });

  it('14 the deadline stops a long generation', async () => {
    const slow = makeApps({ chunkDelayMs: 50, deadlineMs: 300 });
    await seedProject('u10', 'p');
    const r = await generate(slow.generate, 'u10', 'p', 'x #slow');
    expect(r.last).toMatchObject({
      type: 'generation.failed',
      data: { error: { code: 'GENERATION_TIMEOUT' } },
    });
  });

  it('15 refusal fails without partial', async () => {
    await seedProject('u11', 'p');
    const r = await generate(app, 'u11', 'p', 'x #refuse');
    expect(r.last).toMatchObject({
      type: 'generation.failed',
      data: { error: { code: 'GENERATION_REFUSED' }, partial: null },
    });
  });

  it('16 deletes apply, deleting index.html is rejected', async () => {
    await seedProject('u12', 'p');
    await generate(app, 'u12', 'p', 'Dashboard with a helper #with-old');
    expect(await files('u12', 'p')).toContain('old.js');
    const r = await generate(app, 'u12', 'p', 'cleanup #delete');
    const deleted = r.frames
      .filter((f) => f.event === 'file.deleted')
      .map((f) => (f.data as { data: { path: string; status: string } }).data);
    expect(deleted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'old.js', status: 'valid' }),
        expect.objectContaining({ path: 'index.html', status: 'rejected' }),
      ]),
    );
    expect(r.last).toMatchObject({
      type: 'generation.completed',
      data: { deletedPaths: ['old.js'], rejected: [{ path: 'index.html' }] },
    });
    const remaining = await files('u12', 'p');
    expect(remaining).toContain('index.html');
    expect(remaining).not.toContain('old.js');
  });
});
```

> Scenario 7 depends on scenario 1's project (`u1/p`) so the partial `index.html` is applyable — keep the file's tests in order (Vitest runs tests in a file sequentially).

- [ ] **Step 3: Run** — `npm run test:integration` (root). Expected: 16 passed. Fix any failure before moving on — this suite is the proof that R-BE4/5/6/8 and R-C5 hold.

- [ ] **Step 4: Commit** — `test(functions): add 16-scenario generation integration matrix`.
