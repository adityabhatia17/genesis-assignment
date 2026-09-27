import type { SnapshotFileEntry } from '@/contracts/firestore-docs';

export type FileChangeKind = 'added' | 'modified' | 'deleted';

export interface FileChange {
  path: string;
  kind: FileChangeKind;
  beforeBlobId: string | null;
  afterBlobId: string | null;
}

export type DiffRowKind = 'same' | 'add' | 'remove' | 'change';

export interface DiffRow {
  kind: DiffRowKind;
  left: string | null;
  right: string | null;
}

const KIND_ORDER: Record<FileChangeKind, number> = { added: 0, modified: 1, deleted: 2 };
/** Above this, pairing lines is skipped so a large file cannot freeze the dialog. */
const MAX_CELLS = 200_000;

export function filesByPath(
  files: Record<string, SnapshotFileEntry>,
): Map<string, SnapshotFileEntry> {
  return new Map(Object.values(files).map((file) => [file.path, file]));
}

/** Files whose content differs. Same blob id means unchanged and is omitted. */
export function classifyChanges(
  before: ReadonlyMap<string, { blobId: string }>,
  after: ReadonlyMap<string, { blobId: string }>,
): FileChange[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  const changes: FileChange[] = [];
  for (const path of paths) {
    const left = before.get(path);
    const right = after.get(path);
    if (left && !right) {
      changes.push({ path, kind: 'deleted', beforeBlobId: left.blobId, afterBlobId: null });
    } else if (!left && right) {
      changes.push({ path, kind: 'added', beforeBlobId: null, afterBlobId: right.blobId });
    } else if (left && right && left.blobId !== right.blobId) {
      changes.push({
        path,
        kind: 'modified',
        beforeBlobId: left.blobId,
        afterBlobId: right.blobId,
      });
    }
  }
  return changes.sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.path.localeCompare(b.path),
  );
}

function linesOf(text: string): string[] {
  if (text === '') return [];
  return text.split('\n');
}

/** Side-by-side rows. Consecutive removals and additions on the same span become changes. */
export function diffLines(before: string, after: string): DiffRow[] {
  const left = linesOf(before);
  const right = linesOf(after);
  if (left.length * right.length > MAX_CELLS) {
    return [
      ...left.map((line) => ({ kind: 'remove' as const, left: line, right: null })),
      ...right.map((line) => ({ kind: 'add' as const, left: null, right: line })),
    ];
  }
  const n = left.length;
  const m = right.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]!;
    const next = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j--) {
      row[j] = left[i] === right[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!);
    }
  }
  const ops: { op: 'eq' | 'del' | 'ins'; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      ops.push({ op: 'eq', text: left[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ op: 'del', text: left[i]! });
      i += 1;
    } else {
      ops.push({ op: 'ins', text: right[j]! });
      j += 1;
    }
  }
  while (i < n) ops.push({ op: 'del', text: left[i++]! });
  while (j < m) ops.push({ op: 'ins', text: right[j++]! });
  return pairOps(ops);
}

function pairOps(ops: { op: 'eq' | 'del' | 'ins'; text: string }[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let k = 0;
  while (k < ops.length) {
    const op = ops[k]!;
    if (op.op === 'eq') {
      rows.push({ kind: 'same', left: op.text, right: op.text });
      k += 1;
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    while (k < ops.length && ops[k]!.op === 'del') removed.push(ops[k++]!.text);
    while (k < ops.length && ops[k]!.op === 'ins') added.push(ops[k++]!.text);
    const span = Math.max(removed.length, added.length);
    for (let t = 0; t < span; t++) {
      const left = removed[t] ?? null;
      const right = added[t] ?? null;
      const kind: DiffRowKind =
        left !== null && right !== null ? 'change' : left !== null ? 'remove' : 'add';
      rows.push({ kind, left, right });
    }
  }
  return rows;
}
