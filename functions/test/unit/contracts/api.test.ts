import { FileSaveParams, OAuthStartBody, StartGenerationBody } from '../../../src/contracts/api.js';

describe('api contracts', () => {
  it('validates generation start', () => {
    const ok = StartGenerationBody.parse({
      clientRequestId: '6f1f8d0e-4a5b-4c3d-9e2f-1a2b3c4d5e6f',
      prompt: '  Build a dashboard  ',
    });
    expect(ok.prompt).toBe('Build a dashboard');
    expect(() => StartGenerationBody.parse({ clientRequestId: 'x', prompt: 'a' })).toThrow();
    expect(() =>
      StartGenerationBody.parse({ clientRequestId: '6f1f8d0e-4a5b-4c3d-9e2f-1a2b3c4d5e6f', prompt: '' }),
    ).toThrow();
  });
  it('only accepts internal return paths', () => {
    expect(OAuthStartBody.parse({ returnPath: '/dashboard' })).toBeTruthy();
    expect(() => OAuthStartBody.parse({ returnPath: '//evil.com' })).toThrow();
    expect(() => OAuthStartBody.parse({ returnPath: 'https://evil.com' })).toThrow();
  });
  it('accepts only 20-hex file ids', () => {
    expect(FileSaveParams.parse({ projectId: 'abc', fileId: 'a'.repeat(20) })).toBeTruthy();
    expect(() => FileSaveParams.parse({ projectId: 'abc', fileId: '../x' })).toThrow();
  });
});
