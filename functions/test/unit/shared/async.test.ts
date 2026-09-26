import { retry, withTimeout } from '../../../src/shared/async.js';

describe('async helpers', () => {
  it('retries until success', async () => {
    let n = 0;
    const out = await retry(
      async () => {
        n += 1;
        if (n < 3) throw new Error('flaky');
        return 'ok';
      },
      { attempts: 3, baseMs: 1 },
    );
    expect(out).toBe('ok');
    expect(n).toBe(3);
  });
  it('times out', async () => {
    await expect(withTimeout(new Promise(() => undefined), 10, () => new Error('late'))).rejects.toThrow(
      'late',
    );
  });
});
