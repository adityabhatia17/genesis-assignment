import type { TreeFile } from '../../../src/modules/generation/validation/validate-project.js';
import { diffManifests, manifestOf } from '../../../src/modules/snapshots/snapshot-builder.js';

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
