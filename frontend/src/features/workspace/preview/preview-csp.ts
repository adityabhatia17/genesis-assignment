/**
 * First element of every preview document. Blocks all network egress; inline code only.
 * `form-action 'none'` pairs with sandbox `allow-forms`: submit handlers run, real submissions don't.
 */
export const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * Without allow-forms browsers never fire `submit` in a sandboxed document, which breaks ordinary
 * generated forms. Never add allow-same-origin, allow-popups, allow-top-navigation or allow-modals.
 */
export const PREVIEW_SANDBOX = 'allow-scripts allow-forms';
