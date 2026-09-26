import { compilePreview, escapeInlineScript } from '@/features/workspace/preview/compile-preview';
import { PREVIEW_CSP } from '@/features/workspace/preview/preview-csp';

const INDEX = `<!DOCTYPE html><html><head><title>T</title><link rel="stylesheet" href="./styles.css?v=1"><link rel="stylesheet" href="https://cdn.example/x.css"></head>
<body><div id="app"></div><script src="app.js"></script><script src="missing.js"></script></body></html>`;

describe('compilePreview', () => {
  const files = [
    { path: 'index.html', content: INDEX },
    { path: 'styles.css', content: 'body { color: red }' },
    { path: 'app.js', content: 'const s = "</script><!--";' },
  ];

  it('puts charset, CSP and the runtime first in <head>', () => {
    const { html } = compilePreview({ files, runtimeSource: 'window.RT=1;', nonce: 'n0nce123' });
    const doc = new DOMParser().parseFromString(html!, 'text/html');
    const [first, second, third] = Array.from(doc.head.children);
    expect(first?.getAttribute('charset')).toBe('utf-8');
    expect(second?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(second?.getAttribute('content')).toBe(PREVIEW_CSP);
    expect(third?.textContent).toContain('window.__GENESIS_NONCE__="n0nce123"');
  });

  it('inlines local CSS/JS, escapes closing tags and reports missing or remote refs', () => {
    const { html, issues } = compilePreview({ files, runtimeSource: '', nonce: 'n0nce123' });
    expect(html).toContain('<style data-genesis-href="styles.css">body { color: red }</style>');
    expect(html).toContain('const s = "<\\/script><\\!--";');
    expect(html).not.toContain('cdn.example');
    expect(issues.map((i) => i.code).sort()).toEqual(['MISSING_FILE', 'REMOTE_RESOURCE_REMOVED']);
  });

  it('moves deferred scripts to the end of <body> to keep their timing', () => {
    const index =
      '<html><head><script src="app.js" defer></script></head><body><p id="x"></p></body></html>';
    const { html } = compilePreview({
      files: [
        { path: 'index.html', content: index },
        { path: 'app.js', content: 'go()' },
      ],
      runtimeSource: '',
      nonce: 'n0nce123',
    });
    expect(html).toMatch(
      /<p id="x"><\/p><script data-genesis-src="app.js">go\(\)<\/script><\/body>/,
    );
  });

  it('removes <base> and meta refresh; reports a missing entry', () => {
    const index =
      '<html><head><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example"></head><body></body></html>';
    const { html } = compilePreview({
      files: [{ path: 'index.html', content: index }],
      runtimeSource: '',
      nonce: 'n0nce123',
    });
    expect(html).not.toContain('evil.example');
    expect(compilePreview({ files: [], runtimeSource: '', nonce: 'x' })).toEqual({
      html: null,
      issues: [{ code: 'NO_ENTRY', message: 'index.html is missing.' }],
    });
  });

  it('escapes case-insensitively', () => {
    expect(escapeInlineScript('</SCRIPT>')).toBe('<\\/SCRIPT>');
  });
});
