import type { FileLanguage } from '../../../contracts/paths.js';

export interface ContentRule {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly appliesTo: readonly FileLanguage[] | 'all';
  readonly pattern: RegExp;
  readonly message: string;
}

export const CONTENT_RULES: readonly ContentRule[] = [
  {
    code: 'CONTENT_MARKER',
    severity: 'error',
    appliesTo: 'all',
    pattern: /⟦(?:FILE|DELETE|\/FILE⟧)/,
    message: 'File content contains a protocol marker.',
  },
  {
    code: 'HL_API_URL',
    severity: 'error',
    appliesTo: 'all',
    pattern: /leadconnectorhq\.com|rest\.gohighlevel\.com|services\.gohighlevel\.com/i,
    message: 'Call HighLevel only through window.genesis.highlevel.',
  },
  {
    code: 'SECRET_LIKE',
    severity: 'error',
    appliesTo: 'all',
    pattern:
      /sk-ant-[A-Za-z0-9_-]{10,}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}|Bearer\s+[A-Za-z0-9._-]{24,}/,
    message: 'Content contains a credential-like string.',
  },
  {
    code: 'NETWORK_API',
    severity: 'warning',
    appliesTo: ['javascript', 'html'],
    pattern: /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|new\s+EventSource|navigator\.sendBeacon/,
    message: 'Network APIs are blocked in the preview; use window.genesis.highlevel.',
  },
  {
    code: 'BLOCKED_DIALOG',
    severity: 'warning',
    appliesTo: ['javascript', 'html'],
    pattern: /\b(?:alert|confirm|prompt)\s*\(/,
    message: 'Browser dialogs are blocked in the preview.',
  },
  {
    code: 'INNER_HTML',
    severity: 'warning',
    appliesTo: ['javascript', 'html'],
    pattern: /\.innerHTML\s*=(?!=)|insertAdjacentHTML\s*\(/,
    message: 'Insert API data with textContent, not innerHTML.',
  },
  {
    code: 'REMOTE_CSS',
    severity: 'warning',
    appliesTo: ['css'],
    pattern: /@import\s+(?:url\()?\s*['"]?(?:https?:)?\/\/|url\(\s*['"]?(?:https?:)?\/\//i,
    message: 'Remote CSS resources are blocked in the preview.',
  },
];
