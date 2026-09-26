import { isValidFilePath, languageForPath } from '../../../src/contracts/paths.js';

describe('file path rules', () => {
  it.each([
    'index.html',
    'styles.css',
    'app.js',
    'js/api.js',
    'css/cards.css',
    'a/b/c.js',
    'lib/date-utils.min.js',
  ])('accepts %s', (p) => {
    expect(isValidFilePath(p)).toBe(true);
  });
  it.each([
    'about.html',
    'pages/index.html',
    'App.js',
    '../x.js',
    '/app.js',
    'a/b/c/d.js',
    'x.ts',
    'x',
    '.env',
    'a b.js',
    'js//a.js',
  ])('rejects %s', (p) => {
    expect(isValidFilePath(p)).toBe(false);
  });
  it('derives language from the extension', () => {
    expect(languageForPath('index.html')).toBe('html');
    expect(languageForPath('x.css')).toBe('css');
    expect(languageForPath('x.js')).toBe('javascript');
    expect(languageForPath('x.ts')).toBeNull();
  });
});
