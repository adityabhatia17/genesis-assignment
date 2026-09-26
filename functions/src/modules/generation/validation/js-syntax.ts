import { parse } from 'acorn';
import type { Issue } from '../../../contracts/firestore-docs.js';

export function checkJsSyntax(code: string): Issue | null {
  try {
    parse(code, { ecmaVersion: 'latest', sourceType: 'script' });
    return null;
  } catch (err) {
    const e = err as { message?: string; loc?: { line: number; column: number } };
    return {
      code: 'JS_SYNTAX',
      severity: 'error',
      message: e.message ?? 'Invalid JavaScript',
      ...(e.loc ? { line: e.loc.line, column: e.loc.column + 1 } : {}),
    };
  }
}
