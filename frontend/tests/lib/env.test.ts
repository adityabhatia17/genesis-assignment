import { parseEnv } from '@/lib/env';

const valid = {
  VITE_FIREBASE_API_KEY: 'key',
  VITE_FIREBASE_AUTH_DOMAIN: 'x.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'x',
  VITE_FIREBASE_APP_ID: '1:2:web:3',
  VITE_API_BASE_URL: 'https://us-central1-x.cloudfunctions.net/api/',
  VITE_GENERATE_BASE_URL: 'https://us-central1-x.cloudfunctions.net/generate',
};

describe('parseEnv', () => {
  it('normalizes base URLs and defaults emulators off', () => {
    const result = parseEnv(valid);
    expect(result.ok && result.env.apiBaseUrl).toBe('https://us-central1-x.cloudfunctions.net/api');
    expect(result.ok && result.env.useEmulators).toBe(false);
  });

  it('lists every problem instead of failing silently', () => {
    const result = parseEnv({
      ...valid,
      VITE_FIREBASE_API_KEY: '',
      VITE_API_BASE_URL: 'not a url',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.join('\n')).toMatch(/VITE_FIREBASE_API_KEY/);
      expect(result.problems.join('\n')).toMatch(/VITE_API_BASE_URL/);
    }
  });
});
