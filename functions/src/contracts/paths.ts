import { z } from 'zod';

/** Up to two folders + file name; lowercase; html/css/js only. */
export const FILE_PATH_RE = /^(?:[a-z0-9_-]+\/){0,2}[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.(?:html|css|js)$/;
export const ENTRY_FILE = 'index.html';

export const FileLanguageSchema = z.enum(['html', 'css', 'javascript']);
export type FileLanguage = z.infer<typeof FileLanguageSchema>;

export function languageForPath(path: string): FileLanguage | null {
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.js')) return 'javascript';
  return null;
}

export function isValidFilePath(path: string): boolean {
  if (!FILE_PATH_RE.test(path)) return false;
  return !path.endsWith('.html') || path === ENTRY_FILE;
}
