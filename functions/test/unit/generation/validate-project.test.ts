import {
  applyOps,
  validateProject,
  type TreeFile,
} from '../../../src/modules/generation/validation/validate-project.js';
import {
  validateWrite,
  type FileOp,
} from '../../../src/modules/generation/validation/validate-file.js';

const write = (path: string, content: string) => validateWrite(path, content).op as FileOp;
const INDEX =
  '<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head><body><script src="app.js"></script></body></html>';

describe('project validation', () => {
  it('accepts a coherent tree', () => {
    const tree = applyOps(new Map(), [
      write('index.html', INDEX),
      write('styles.css', 'body{}'),
      write('app.js', 'var a=1;'),
    ]);
    expect(validateProject(tree).filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('requires index.html and resolvable references', () => {
    expect(
      validateProject(applyOps(new Map(), [write('app.js', 'var a=1;')])).map((i) => i.code),
    ).toContain('INDEX_MISSING');
    const missing = validateProject(
      applyOps(new Map(), [write('index.html', INDEX), write('styles.css', 'body{}')]),
    );
    expect(missing).toContainEqual(
      expect.objectContaining({ code: 'REF_MISSING', path: 'app.js' }),
    );
  });
  it('applies deletes and warns about unreferenced files', () => {
    const base = applyOps(new Map(), [
      write('index.html', INDEX),
      write('styles.css', 'x{}'),
      write('app.js', 'var a;'),
      write('old.js', 'var b;'),
    ]);
    expect(validateProject(base).map((i) => i.code)).toContain('UNREFERENCED_FILE');
    const next = applyOps(base, [{ op: 'delete', path: 'old.js' }]);
    expect(next.has('old.js')).toBe(false);
    expect(validateProject(next).map((i) => i.code)).not.toContain('UNREFERENCED_FILE');
  });
  it('enforces caps', () => {
    const many = new Map<string, TreeFile>();
    for (let i = 0; i < 26; i += 1)
      many.set(`f${i}.js`, {
        path: `f${i}.js`,
        content: 'x',
        sizeBytes: 1,
        sha256: 'h',
        language: 'javascript',
      });
    expect(validateProject(many).map((i) => i.code)).toContain('TOO_MANY_FILES');
  });
});
