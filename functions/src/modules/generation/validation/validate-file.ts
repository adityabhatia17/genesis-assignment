import type { Issue } from '../../../contracts/firestore-docs.js';
import { LIMITS } from '../../../contracts/limits.js';
import {
  ENTRY_FILE,
  isValidFilePath,
  languageForPath,
  type FileLanguage,
} from '../../../contracts/paths.js';
import { sha256Hex, utf8Bytes } from '../../../shared/hash.js';
import { CONTENT_RULES } from './file-rules.js';
import { extractLocalRefs } from './html-refs.js';
import { checkJsSyntax } from './js-syntax.js';

export type FileOp =
  | {
      op: 'write';
      path: string;
      content: string;
      sizeBytes: number;
      sha256: string;
      language: FileLanguage;
    }
  | { op: 'delete'; path: string };

export interface FileValidation {
  ok: boolean;
  issues: Issue[];
  op: FileOp | null;
}

export const hasErrors = (issues: readonly Issue[]): boolean =>
  issues.some((i) => i.severity === 'error');

const issue = (
  code: string,
  message: string,
  path: string,
  severity: Issue['severity'] = 'error',
): Issue => ({
  code,
  message,
  severity,
  path,
});

export function validatePath(path: string): Issue[] {
  return isValidFilePath(path)
    ? []
    : [
        issue(
          'PATH_INVALID',
          'Allowed: index.html at the root plus lowercase .css/.js files, at most two folders deep.',
          path,
        ),
      ];
}

export function validateWrite(path: string, content: string): FileValidation {
  const issues = validatePath(path);
  const language = languageForPath(path);
  const sizeBytes = utf8Bytes(content);

  if (content.trim() === '') issues.push(issue('FILE_EMPTY', 'File is empty.', path));
  if (sizeBytes > LIMITS.maxFileBytes)
    issues.push(issue('FILE_TOO_LARGE', `File exceeds ${LIMITS.maxFileBytes} bytes.`, path));
  if (content.includes('\u0000'))
    issues.push(issue('CONTENT_NUL', 'File contains a NUL character.', path));

  if (language) {
    for (const rule of CONTENT_RULES) {
      if (
        (rule.appliesTo === 'all' || rule.appliesTo.includes(language)) &&
        rule.pattern.test(content)
      ) {
        issues.push(issue(rule.code, rule.message, path, rule.severity));
      }
    }
    if (language === 'javascript' && sizeBytes <= LIMITS.maxFileBytes) {
      const syntax = checkJsSyntax(content);
      if (syntax) issues.push({ ...syntax, path });
    }
    if (language === 'html' && path === ENTRY_FILE) {
      if (!/<html[\s>]/i.test(content) || !/<body[\s>]/i.test(content)) {
        issues.push(
          issue(
            'HTML_NOT_DOCUMENT',
            'index.html must be a complete HTML document with <html> and <body>.',
            path,
          ),
        );
      }
      for (const remote of extractLocalRefs(content).remote) {
        issues.push(
          issue('REMOTE_RESOURCE', `Remote resource not allowed: ${remote.slice(0, 120)}`, path),
        );
      }
    }
  }

  const ok = !hasErrors(issues);
  return {
    ok,
    issues,
    op:
      ok && language
        ? { op: 'write', path, content, sizeBytes, sha256: sha256Hex(content), language }
        : null,
  };
}

export function validateDelete(path: string, existingPaths: ReadonlySet<string>): FileValidation {
  const issues = validatePath(path);
  if (path === ENTRY_FILE)
    issues.push(issue('DELETE_FORBIDDEN', 'index.html cannot be deleted.', path));
  if (hasErrors(issues)) return { ok: false, issues, op: null };
  if (!existingPaths.has(path))
    return {
      ok: true,
      issues: [issue('DELETE_UNKNOWN', 'File does not exist; nothing to delete.', path, 'warning')],
      op: null,
    };
  return { ok: true, issues, op: { op: 'delete', path } };
}
