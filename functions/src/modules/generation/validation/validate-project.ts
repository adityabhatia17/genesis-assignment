import type { Issue } from '../../../contracts/firestore-docs.js';
import { LIMITS } from '../../../contracts/limits.js';
import { ENTRY_FILE, type FileLanguage } from '../../../contracts/paths.js';
import { extractLocalRefs } from './html-refs.js';
import type { FileOp } from './validate-file.js';

export interface TreeFile {
  path: string;
  content: string;
  sizeBytes: number;
  sha256: string;
  language: FileLanguage;
}
export type Tree = ReadonlyMap<string, TreeFile>;

export function applyOps(tree: Tree, ops: readonly FileOp[]): Map<string, TreeFile> {
  const next = new Map(tree);
  for (const op of ops) {
    if (op.op === 'delete') next.delete(op.path);
    else
      next.set(op.path, {
        path: op.path,
        content: op.content,
        sizeBytes: op.sizeBytes,
        sha256: op.sha256,
        language: op.language,
      });
  }
  return next;
}

export function validateProject(tree: Tree): Issue[] {
  const issues: Issue[] = [];
  const index = tree.get(ENTRY_FILE);
  if (!index)
    issues.push({
      code: 'INDEX_MISSING',
      severity: 'error',
      message: 'The project needs an index.html at the root.',
    });
  if (tree.size > LIMITS.maxFiles)
    issues.push({
      code: 'TOO_MANY_FILES',
      severity: 'error',
      message: `At most ${LIMITS.maxFiles} files are allowed.`,
    });
  const total = [...tree.values()].reduce((sum, f) => sum + f.sizeBytes, 0);
  if (total > LIMITS.maxProjectBytes)
    issues.push({
      code: 'PROJECT_TOO_LARGE',
      severity: 'error',
      message: `The project exceeds ${LIMITS.maxProjectBytes} bytes.`,
    });

  if (index) {
    const refs = extractLocalRefs(index.content);
    const referenced = new Set([...refs.scripts, ...refs.styles]);
    for (const ref of referenced) {
      if (!tree.has(ref))
        issues.push({
          code: 'REF_MISSING',
          severity: 'error',
          path: ref,
          message: `index.html references ${ref}, which does not exist.`,
        });
    }
    for (const f of tree.values()) {
      if (f.path !== ENTRY_FILE && !referenced.has(f.path)) {
        issues.push({
          code: 'UNREFERENCED_FILE',
          severity: 'warning',
          path: f.path,
          message: `${f.path} is not referenced by index.html.`,
        });
      }
    }
  }
  return issues;
}
