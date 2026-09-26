import {
  validateDelete,
  validateWrite,
} from '../../../src/modules/generation/validation/validate-file.js';
import { extractLocalRefs } from '../../../src/modules/generation/validation/html-refs.js';

const html = (body = '<script src="app.js"></script>') =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head><body>${body}</body></html>`;
const codes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code);

describe('validateWrite', () => {
  it('accepts a clean file and returns an op with bytes and hash', () => {
    const r = validateWrite('app.js', 'const a = 1;\n');
    expect(r.ok).toBe(true);
    expect(r.op).toMatchObject({
      op: 'write',
      path: 'app.js',
      language: 'javascript',
      sizeBytes: 13,
    });
    expect(r.op && r.op.op === 'write' && r.op.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it.each([
    ['Index.html', '<html><body></body></html>', 'PATH_INVALID'],
    ['app.js', '   ', 'FILE_EMPTY'],
    ['app.js', 'x'.repeat(102_401), 'FILE_TOO_LARGE'],
    ['app.js', 'let = ;', 'JS_SYNTAX'],
    ['app.js', 'import x from "y";', 'JS_SYNTAX'],
    ['app.js', 'fetch("https://services.leadconnectorhq.com/contacts")', 'HL_API_URL'],
    ['app.js', 'const k = "sk-ant-api03-abcdefghijklmnop";', 'SECRET_LIKE'],
    ['app.js', 'a\u0000b', 'CONTENT_NUL'],
    ['app.js', '// ⟦FILE path="x.js"⟧', 'CONTENT_MARKER'],
    ['index.html', '<p>no document</p>', 'HTML_NOT_DOCUMENT'],
    ['index.html', html('<script src="https://cdn.example/x.js"></script>'), 'REMOTE_RESOURCE'],
  ])('rejects %s → %s', (path, content, code) => {
    const r = validateWrite(path, content);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain(code);
  });
  it('warns (but accepts) network APIs, dialogs and innerHTML', () => {
    const r = validateWrite('app.js', 'fetch("/x"); alert(1); el.innerHTML = s;');
    expect(r.ok).toBe(true);
    expect(codes(r)).toEqual(
      expect.arrayContaining(['NETWORK_API', 'BLOCKED_DIALOG', 'INNER_HTML']),
    );
  });
  it('reports JS syntax position', () => {
    const r = validateWrite('app.js', 'const a = 1;\nconst = 2;');
    expect(r.issues.find((i) => i.code === 'JS_SYNTAX')).toMatchObject({ line: 2 });
  });
});

describe('validateDelete', () => {
  it('forbids deleting index.html and warns on unknown files', () => {
    expect(codes(validateDelete('index.html', new Set(['index.html'])))).toContain(
      'DELETE_FORBIDDEN',
    );
    const unknown = validateDelete('ghost.js', new Set(['index.html']));
    expect(unknown.ok).toBe(true);
    expect(unknown.op).toBeNull();
    expect(codes(unknown)).toContain('DELETE_UNKNOWN');
    expect(validateDelete('old.js', new Set(['old.js'])).op).toEqual({
      op: 'delete',
      path: 'old.js',
    });
  });
});

describe('extractLocalRefs', () => {
  it('finds local scripts and stylesheets, separating remote ones', () => {
    const refs = extractLocalRefs(
      html(
        '<script src="./js/api.js?v=1"></script><script src="//cdn.x/y.js"></script><script>inline()</script>',
      ),
    );
    expect(refs.styles).toEqual(['styles.css']);
    expect(refs.scripts).toEqual(['js/api.js']);
    expect(refs.remote).toEqual(['//cdn.x/y.js']);
  });
});
