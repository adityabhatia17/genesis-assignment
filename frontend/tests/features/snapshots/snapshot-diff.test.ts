import { classifyChanges, diffLines, filesByPath } from '@/features/snapshots/snapshot-diff';
import type { SnapshotFileEntry } from '@/contracts/firestore-docs';

const entry = (path: string, blobId: string): SnapshotFileEntry => ({
  path,
  blobId,
  sizeBytes: 1,
  language: 'javascript',
});

describe('snapshot diff', () => {
  it('classifies added, modified and deleted files and skips unchanged blobs', () => {
    const before = filesByPath({
      a: entry('app.js', 'blob-a'),
      b: entry('old.css', 'blob-b'),
      c: entry('keep.html', 'blob-c'),
    });
    const after = filesByPath({
      a: entry('app.js', 'blob-a2'),
      c: entry('keep.html', 'blob-c'),
      d: entry('new.js', 'blob-d'),
    });
    expect(classifyChanges(before, after)).toEqual([
      { path: 'new.js', kind: 'added', beforeBlobId: null, afterBlobId: 'blob-d' },
      { path: 'app.js', kind: 'modified', beforeBlobId: 'blob-a', afterBlobId: 'blob-a2' },
      { path: 'old.css', kind: 'deleted', beforeBlobId: 'blob-b', afterBlobId: null },
    ]);
  });

  it('pairs a changed line and keeps equal lines on both sides', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc')).toEqual([
      { kind: 'same', left: 'a', right: 'a' },
      { kind: 'change', left: 'b', right: 'B' },
      { kind: 'same', left: 'c', right: 'c' },
    ]);
  });

  it('shows a pure addition and a pure deletion', () => {
    expect(diffLines('only', '')).toEqual([{ kind: 'remove', left: 'only', right: null }]);
    expect(diffLines('', 'new')).toEqual([{ kind: 'add', left: null, right: 'new' }]);
  });
});
