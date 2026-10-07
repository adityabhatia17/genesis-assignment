import { overlayOps } from '@/features/variants/candidate-files';

describe('overlayOps', () => {
  const base = [
    { path: 'index.html', content: 'old' },
    { path: 'app.js', content: 'keep' },
  ];

  it('adds, replaces and deletes, then sorts', () => {
    const next = overlayOps(base, [
      { path: 'styles.css', op: 'write', content: 'body{}' },
      { path: 'index.html', op: 'write', content: 'new' },
      { path: 'app.js', op: 'delete', content: '' },
      { path: 'missing.js', op: 'delete', content: '' },
    ]);
    expect(next).toEqual([
      { path: 'index.html', content: 'new' },
      { path: 'styles.css', content: 'body{}' },
    ]);
  });

  it('is idempotent for the same ops', () => {
    const ops = [{ path: 'index.html', op: 'write' as const, content: 'a' }];
    expect(overlayOps(overlayOps([], ops), ops)).toEqual(overlayOps([], ops));
  });
});
