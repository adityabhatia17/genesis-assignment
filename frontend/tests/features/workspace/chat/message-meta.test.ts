import { describeMessageMeta } from '@/features/workspace/chat/message-meta';

describe('describeMessageMeta', () => {
  it('summarizes a completed generation', () => {
    expect(
      describeMessageMeta('assistant', {
        status: 'completed',
        changedPaths: ['index.html', 'app.js'],
        snapshotSeq: 4,
        rejectedPaths: ['x.js'],
      }),
    ).toEqual({
      text: 'Changed index.html, app.js · History #4 · 1 file rejected',
      tone: 'warning',
    });
  });

  it('shortens long lists and handles outcomes', () => {
    expect(
      describeMessageMeta('system', {
        changedPaths: ['a.js', 'b.js', 'c.js', 'd.js'],
        snapshotSeq: 8,
      })?.text,
    ).toBe('Changed a.js, b.js, c.js +1 more · History #8');
    expect(describeMessageMeta('assistant', { status: 'failed' })).toEqual({
      text: 'Generation failed',
      tone: 'error',
    });
    expect(describeMessageMeta('user', { status: 'completed' })).toBeNull();
  });
});
