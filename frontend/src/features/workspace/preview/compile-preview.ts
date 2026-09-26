import { ENTRY_FILE } from '@/contracts/paths';
import { PREVIEW_CSP } from './preview-csp';
import { normalizeRef } from './preview-refs';

export interface PreviewFile {
  path: string;
  content: string;
}

export interface PreviewIssue {
  code: 'NO_ENTRY' | 'MISSING_FILE' | 'REMOTE_RESOURCE_REMOVED';
  message: string;
}

export interface CompiledPreview {
  html: string | null;
  issues: PreviewIssue[];
}

/** Inline scripts end at the first `</script`; `<!--` can switch the parser into an escape state. */
export const escapeInlineScript = (code: string): string =>
  code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const escapeInlineStyle = (css: string): string => css.replace(/<\/(style)/gi, '<\\/$1');

/**
 * Builds one self-contained document from the committed files (FSD §13.1):
 * CSP meta first, then the runtime, then the app with local CSS/JS inlined.
 */
export function compilePreview(input: {
  files: readonly PreviewFile[];
  runtimeSource: string;
  nonce: string;
}): CompiledPreview {
  const byPath = new Map(input.files.map((f) => [f.path, f.content]));
  const entry = byPath.get(ENTRY_FILE);
  if (entry === undefined) {
    return { html: null, issues: [{ code: 'NO_ENTRY', message: 'index.html is missing.' }] };
  }

  const doc = new DOMParser().parseFromString(entry, 'text/html'); // inert: nothing executes
  const issues: PreviewIssue[] = [];
  const remote = (ref: string) =>
    issues.push({
      code: 'REMOTE_RESOURCE_REMOVED',
      message: `Removed external resource ${ref} (the preview has no network).`,
    });
  const missing = (ref: string) =>
    issues.push({ code: 'MISSING_FILE', message: `${ref} is referenced but does not exist.` });

  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const href = link.getAttribute('href') ?? '';
    const local = normalizeRef(href);
    const css = local === null ? undefined : byPath.get(local);
    if (local === null) remote(href);
    else if (css === undefined) missing(local);
    if (local === null || css === undefined) {
      link.remove();
      continue;
    }
    const style = doc.createElement('style');
    style.setAttribute('data-genesis-href', local);
    style.textContent = escapeInlineStyle(css);
    link.replaceWith(style);
  }

  const deferred: HTMLScriptElement[] = [];
  for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
    const src = script.getAttribute('src') ?? '';
    const local = normalizeRef(src);
    const js = local === null ? undefined : byPath.get(local);
    if (local === null) remote(src);
    else if (js === undefined) missing(local);
    if (local === null || js === undefined) {
      script.remove();
      continue;
    }
    const inline = doc.createElement('script');
    inline.setAttribute('data-genesis-src', local);
    inline.textContent = escapeInlineScript(js);
    // Inline scripts ignore defer/async/module: keep "runs after parsing" by moving them to the end.
    if (
      script.hasAttribute('defer') ||
      script.hasAttribute('async') ||
      script.getAttribute('type') === 'module'
    ) {
      script.remove();
      deferred.push(inline);
    } else {
      script.replaceWith(inline);
    }
  }
  doc.body.append(...deferred);

  // <base> would re-target relative URLs; meta refresh would navigate the frame away.
  for (const el of Array.from(doc.querySelectorAll('base, meta[http-equiv]'))) {
    if (el.tagName === 'BASE' || /^refresh$/i.test(el.getAttribute('http-equiv') ?? ''))
      el.remove();
  }

  const csp = doc.createElement('meta');
  csp.setAttribute('http-equiv', 'Content-Security-Policy');
  csp.setAttribute('content', PREVIEW_CSP);
  const runtime = doc.createElement('script');
  runtime.textContent = `window.__GENESIS_NONCE__=${JSON.stringify(input.nonce)};\n${escapeInlineScript(input.runtimeSource)}`;
  const head = doc.head;
  const charset = doc.querySelector('meta[charset]');
  head.prepend(csp, runtime);
  if (charset) head.prepend(charset);
  else {
    const meta = doc.createElement('meta');
    meta.setAttribute('charset', 'utf-8');
    head.prepend(meta);
  }

  return { html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`, issues };
}
