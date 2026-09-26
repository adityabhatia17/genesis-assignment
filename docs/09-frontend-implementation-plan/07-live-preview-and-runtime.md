# FE-6 — Live preview, runtime SDK and host bridge (R-FE5, R-C4)

> Read [`00-overview.md`](00-overview.md) first. Spec: [`../06-frontend-system-design.md`](../06-frontend-system-design.md) §13; contracts: [`../07-end-to-end-system-design.md`](../07-end-to-end-system-design.md) §3.3 (bridge v1), §3.4 (runtime SDK v1), §4.12; security facts: [`../research/05-frontend-stack.md`](../research/05-frontend-stack.md) §5.

**Security model in one paragraph.** The generated app runs in a `srcdoc` iframe with `sandbox="allow-scripts allow-forms"` (opaque origin: no cookies, no storage, no access to the SPA) and a CSP meta tag that blocks all network egress. It holds no credential. Its only door is `window.genesis.highlevel.*`, which sends messages over a private `MessageChannel`; the SPA checks each call against the manifest (method allow-list, zod params, size, rate and concurrency budgets) and performs it with the user's ID token. `allow-forms` is required because browsers never fire `submit` in a sandbox without it; `form-action 'none'` keeps real submissions blocked. CSP cannot stop a document from navigating its own frame, so the panel rebuilds the preview on any second `load` — and the data such a navigation could carry is the user's own CRM data, never a token (residual risk documented in `07` §6.2).

---

### Task FE-6.1: Preview compiler and CSP

**Files:**
- Create: `frontend/src/features/workspace/preview/preview-csp.ts`, `preview-refs.ts`, `compile-preview.ts`
- Test: `frontend/tests/features/workspace/preview/compile-preview.test.ts`

**Interfaces:** Produces `PREVIEW_CSP`, `PREVIEW_SANDBOX`, `normalizeRef(ref)` (same rule as the server's `html-refs.ts`), `compilePreview({ files, runtimeSource, nonce }) → { html: string | null; issues: PreviewIssue[] }`, `escapeInlineScript(code)`.

- [ ] **Step 1: Failing test**

`frontend/tests/features/workspace/preview/compile-preview.test.ts`:
```ts
import { compilePreview, escapeInlineScript } from '@/features/workspace/preview/compile-preview';
import { PREVIEW_CSP } from '@/features/workspace/preview/preview-csp';

const INDEX = `<!DOCTYPE html><html><head><title>T</title><link rel="stylesheet" href="./styles.css?v=1"><link rel="stylesheet" href="https://cdn.example/x.css"></head>
<body><div id="app"></div><script src="app.js"></script><script src="missing.js"></script></body></html>`;

describe('compilePreview', () => {
  const files = [
    { path: 'index.html', content: INDEX },
    { path: 'styles.css', content: 'body { color: red }' },
    { path: 'app.js', content: 'const s = "</script><!--";' },
  ];

  it('puts charset, CSP and the runtime first in <head>', () => {
    const { html } = compilePreview({ files, runtimeSource: 'window.RT=1;', nonce: 'n0nce123' });
    const doc = new DOMParser().parseFromString(html!, 'text/html');
    const [first, second, third] = Array.from(doc.head.children);
    expect(first?.getAttribute('charset')).toBe('utf-8');
    expect(second?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(second?.getAttribute('content')).toBe(PREVIEW_CSP);
    expect(third?.textContent).toContain('window.__GENESIS_NONCE__="n0nce123"');
  });

  it('inlines local CSS/JS, escapes closing tags and reports missing or remote refs', () => {
    const { html, issues } = compilePreview({ files, runtimeSource: '', nonce: 'n0nce123' });
    expect(html).toContain('<style data-genesis-href="styles.css">body { color: red }</style>');
    expect(html).toContain('const s = "<\\/script><\\!--";');
    expect(html).not.toContain('cdn.example');
    expect(issues.map((i) => i.code).sort()).toEqual(['MISSING_FILE', 'REMOTE_RESOURCE_REMOVED']);
  });

  it('moves deferred scripts to the end of <body> to keep their timing', () => {
    const index =
      '<html><head><script src="app.js" defer></script></head><body><p id="x"></p></body></html>';
    const { html } = compilePreview({
      files: [
        { path: 'index.html', content: index },
        { path: 'app.js', content: 'go()' },
      ],
      runtimeSource: '',
      nonce: 'n0nce123',
    });
    expect(html).toMatch(
      /<p id="x"><\/p><script data-genesis-src="app.js">go\(\)<\/script><\/body>/,
    );
  });

  it('removes <base> and meta refresh; reports a missing entry', () => {
    const index =
      '<html><head><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example"></head><body></body></html>';
    const { html } = compilePreview({
      files: [{ path: 'index.html', content: index }],
      runtimeSource: '',
      nonce: 'n0nce123',
    });
    expect(html).not.toContain('evil.example');
    expect(compilePreview({ files: [], runtimeSource: '', nonce: 'x' })).toEqual({
      html: null,
      issues: [{ code: 'NO_ENTRY', message: 'index.html is missing.' }],
    });
  });

  it('escapes case-insensitively', () => {
    expect(escapeInlineScript('</SCRIPT>')).toBe('<\\/SCRIPT>');
  });
});
```

- [ ] **Step 2: Implement**

`frontend/src/features/workspace/preview/preview-csp.ts`:
```ts
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
```

`frontend/src/features/workspace/preview/preview-refs.ts`:
```ts
const isRemote = (ref: string): boolean => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref);

/** Same rule as the server validator (functions html-refs.ts normalizeRef). */
export function normalizeRef(ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed || isRemote(trimmed)) return null;
  return (trimmed.split(/[?#]/)[0] ?? '').replace(/^\.\//, '').replace(/^\//, '');
}
```

`frontend/src/features/workspace/preview/compile-preview.ts`:
```ts
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
```

- [ ] **Step 3: Run** → PASS. **Commit** — `feat(frontend): compile preview documents with network-blocking CSP`

---

### Task FE-6.2: Runtime SDK v1 (`window.genesis`)

**Files:**
- Create: `frontend/src/features/workspace/preview/runtime/genesis-runtime.js` (plain ES2020, imported with `?raw`)
- Test: `frontend/tests/features/workspace/preview/genesis-runtime.test.ts`

**Interfaces:** Inside the iframe: `window.genesis = { version: '1', ready, context, highlevel.{location.get, contacts.list/get, conversations.list/messages, calendars.list/events}, GenesisError }` — exactly what system prompt v1 (BE-5.4) promises the model.

- [ ] **Step 1: Failing test** (evaluates the shipped source against a fake iframe window)

`frontend/tests/features/workspace/preview/genesis-runtime.test.ts`:
```ts
import { RUNTIME_METHOD_NAMES } from '@/contracts/hl-runtime';
import runtimeSource from '@/features/workspace/preview/runtime/genesis-runtime.js?raw';

interface FakePort {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage: ((e: { data: unknown }) => void) | null;
}

/** Evaluates the runtime against a fake iframe window whose parent records postMessage calls. */
function boot(nonce = 'n0nce123') {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const parent = { postMessage: vi.fn() };
  const logs: unknown[][] = [];
  const win: Record<string, unknown> = {
    __GENESIS_NONCE__: nonce,
    parent,
    console: {
      log: (...a: unknown[]) => logs.push(a),
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    addEventListener: (type: string, fn: (e: unknown) => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type: string, fn: (e: unknown) => void) =>
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((f) => f !== fn),
      ),
  };
  // Evaluating the shipped runtime text is the point of this test (it runs as inline script in the iframe).
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('window', runtimeSource)(win);
  const port: FakePort = { postMessage: vi.fn(), onmessage: null };
  const init = (data: Record<string, unknown>, source: unknown = parent) =>
    (listeners.get('message') ?? []).forEach((fn) => fn({ source, data, ports: [port] }));
  const context = {
    location: { id: 'loc', name: 'Demo Clinic', timezone: 'UTC' },
    project: { id: 'p1', name: 'P' },
    hlStatus: 'connected',
  };
  const handshake = () =>
    init({ source: 'genesis-host', type: 'init', protocol: 1, nonce, context });
  const genesis = win['genesis'] as {
    ready: Promise<void>;
    context: unknown;
    highlevel: Record<string, Record<string, (p?: unknown) => Promise<unknown>>>;
    on: (n: string, h: (p: unknown) => void) => () => void;
  };
  return { win, parent, port, init, handshake, genesis, listeners, logs };
}

describe('genesis runtime v1', () => {
  it('says hello with its nonce and hides the nonce from app code', () => {
    const { parent, win } = boot();
    expect(parent.postMessage).toHaveBeenCalledWith(
      { source: 'genesis-preview', type: 'hello', protocol: 1, nonce: 'n0nce123' },
      '*',
    );
    expect(win['__GENESIS_NONCE__']).toBeUndefined();
  });

  it('exposes exactly the manifest methods on a frozen, non-writable global', () => {
    const { win, genesis } = boot();
    const names = Object.entries(genesis.highlevel).flatMap(([area, methods]) =>
      Object.keys(methods).map((m) => `${area}.${m}`),
    );
    expect(names.sort()).toEqual([...RUNTIME_METHOD_NAMES].sort());
    expect(Object.isFrozen(genesis)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(win, 'genesis')).toMatchObject({
      writable: false,
      configurable: false,
    });
  });

  it('ignores init from the wrong source or with the wrong nonce', async () => {
    const { init, genesis } = boot();
    init({ source: 'genesis-host', type: 'init', protocol: 1, nonce: 'n0nce123', context: {} }, {});
    init({ source: 'genesis-host', type: 'init', protocol: 1, nonce: 'wrong', context: {} });
    const settled = await Promise.race([
      genesis.ready.then(() => 'ready'),
      new Promise((r) => setTimeout(() => r('pending'), 10)),
    ]);
    expect(settled).toBe('pending');
  });

  it('queues calls until ready, then resolves and rejects over the port', async () => {
    const { handshake, port, genesis } = boot();
    const pending = genesis.highlevel['contacts']!['list']!({ limit: 5 });
    handshake();
    await genesis.ready;
    await Promise.resolve();
    const rpc = port.postMessage.mock.calls.find(
      ([m]) => (m as { type: string }).type === 'rpc',
    )![0] as { id: string; method: string; params: unknown };
    expect(rpc).toMatchObject({ method: 'contacts.list', params: { limit: 5 } });
    port.onmessage!({
      data: {
        type: 'rpc-result',
        id: rpc.id,
        ok: true,
        result: { items: [], nextCursor: null, hasMore: false },
      },
    });
    await expect(pending).resolves.toEqual({ items: [], nextCursor: null, hasMore: false });

    const failing = genesis.highlevel['contacts']!['get']!({ contactId: 'c1' });
    await Promise.resolve();
    await Promise.resolve();
    const second = port.postMessage.mock.calls.at(-1)![0] as { id: string };
    port.onmessage!({
      data: {
        type: 'rpc-result',
        id: second.id,
        ok: false,
        error: { code: 'HL_NOT_FOUND', message: 'Not found', retryable: false },
      },
    });
    await expect(failing).rejects.toMatchObject({
      name: 'GenesisError',
      code: 'HL_NOT_FOUND',
      retryable: false,
    });
    expect(genesis.context).toEqual({
      location: { id: 'loc', name: 'Demo Clinic', timezone: 'UTC' },
      project: { id: 'p1', name: 'P' },
    });
  });

  it('mirrors console output and shims storage', async () => {
    const { win, handshake, port, genesis } = boot();
    (win['console'] as { log: (...a: unknown[]) => void }).log('hello', { a: 1 });
    const storage = win['localStorage'] as Storage;
    storage.setItem('k', 'v');
    expect(storage.getItem('k')).toBe('v');
    handshake();
    await genesis.ready;
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'console',
      level: 'log',
      args: ['hello', '{"a":1}'],
    });
  });

  it('delivers host events to genesis.on handlers', async () => {
    const { handshake, port, genesis } = boot();
    const handler = vi.fn();
    genesis.on('contact.created', handler);
    handshake();
    await genesis.ready;
    port.onmessage!({ data: { type: 'event', name: 'contact.created', payload: { id: 'c9' } } });
    expect(handler).toHaveBeenCalledWith({ id: 'c9' });
    expect(() => genesis.on('nope', () => undefined)).toThrow(TypeError);
  });
});
```

- [ ] **Step 2: Implement**

`frontend/src/features/workspace/preview/runtime/genesis-runtime.js`:
```js
/*
 * Genesis preview runtime v1 — injected before the app's own scripts in every preview document.
 * It runs in a sandboxed, opaque-origin iframe and holds no credentials: each HighLevel call is an
 * RPC over a MessageChannel to the Genesis host, which validates, rate-limits and authenticates it.
 * Plain ES2020, no imports (it is inlined into the document as text).
 */
(function (window) {
  'use strict';

  var NONCE = window.__GENESIS_NONCE__;
  try {
    delete window.__GENESIS_NONCE__;
  } catch (e) {
    /* ignore */
  }
  var TIMEOUT_MS = 22000; // host enforces 20 s; this is only a backstop
  var METHODS = [
    'location.get',
    'contacts.list',
    'contacts.get',
    'contacts.create',
    'contacts.update',
    'conversations.list',
    'conversations.messages',
    'conversations.send',
    'calendars.list',
    'calendars.events',
    'calendars.freeSlots',
  ];
  var EVENTS = [
    'contact.created',
    'contact.updated',
    'appointment.created',
    'appointment.updated',
    'message.inbound',
  ];

  // ── storage shims: sandboxed documents throw on localStorage/sessionStorage access ──
  function memoryStorage() {
    var data = new Map();
    return {
      get length() {
        return data.size;
      },
      key: function (i) {
        var keys = Array.from(data.keys());
        return i >= 0 && i < keys.length ? keys[i] : null;
      },
      getItem: function (k) {
        k = String(k);
        return data.has(k) ? data.get(k) : null;
      },
      setItem: function (k, v) {
        data.set(String(k), String(v));
      },
      removeItem: function (k) {
        data.delete(String(k));
      },
      clear: function () {
        data.clear();
      },
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    try {
      Object.defineProperty(window, name, { value: memoryStorage(), configurable: true });
    } catch (e) {
      /* keep the platform object */
    }
  });

  // ── outbound queue until the host hands us a port ──
  var port = null;
  var outbox = [];
  function send(message) {
    if (port) port.postMessage(message);
    else if (outbox.length < 200) outbox.push(message);
  }
  function text(value, max) {
    var out;
    try {
      if (typeof value === 'string') out = value;
      else if (value instanceof Error) out = value.name + ': ' + value.message;
      else out = JSON.stringify(value);
    } catch (e) {
      out = String(value);
    }
    if (out === undefined) out = String(value);
    return out.length > max ? out.slice(0, max) + '…' : out;
  }

  // ── console + error mirroring to the host console panel ──
  var consoleRef = window.console;
  ['log', 'info', 'warn', 'error'].forEach(function (level) {
    var original = consoleRef[level] ? consoleRef[level].bind(consoleRef) : function () {};
    consoleRef[level] = function () {
      var args = Array.prototype.slice.call(arguments);
      original.apply(null, args);
      send({
        type: 'console',
        level: level,
        args: args.slice(0, 20).map(function (a) {
          return text(a, 2000);
        }),
      });
    };
  });
  window.addEventListener('error', function (event) {
    send({
      type: 'runtime-error',
      message: text(event.message || 'Script error', 2000),
      stack: event.error && event.error.stack ? text(String(event.error.stack), 8000) : undefined,
    });
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    send({
      type: 'runtime-error',
      message: text(
        'Unhandled promise rejection: ' +
          (reason && reason.message ? reason.message : text(reason, 1000)),
        2000,
      ),
      stack: reason && reason.stack ? text(String(reason.stack), 8000) : undefined,
    });
  });

  // ── errors surfaced to generated code ──
  function GenesisError(code, message, retryable) {
    var error = new Error(message);
    Object.setPrototypeOf(error, GenesisError.prototype);
    error.name = 'GenesisError';
    error.code = code;
    error.retryable = Boolean(retryable);
    return error;
  }
  GenesisError.prototype = Object.create(Error.prototype);
  GenesisError.prototype.constructor = GenesisError;

  // ── handshake ──
  var resolveReady;
  var ready = new Promise(function (resolve) {
    resolveReady = resolve;
  });
  var context = null;
  var pending = new Map();
  var sequence = 0;
  var handlers = new Map();

  function onPortMessage(event) {
    var message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'rpc-result') {
      var call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.ok) call.resolve(message.result);
      else
        call.reject(
          GenesisError(message.error.code, message.error.message, message.error.retryable),
        );
    } else if (message.type === 'event') {
      (handlers.get(message.name) || []).forEach(function (handler) {
        try {
          handler(message.payload);
        } catch (e) {
          consoleRef.error(e);
        }
      });
    }
  }

  function onWindowMessage(event) {
    if (event.source !== window.parent || port) return;
    var message = event.data;
    if (
      !message ||
      message.source !== 'genesis-host' ||
      message.type !== 'init' ||
      message.nonce !== NONCE
    )
      return;
    var channel = event.ports && event.ports[0];
    if (!channel) return;
    port = channel;
    port.onmessage = onPortMessage;
    var ctx = message.context || {};
    context = Object.freeze({ location: ctx.location || null, project: ctx.project || null });
    window.removeEventListener('message', onWindowMessage);
    outbox.splice(0).forEach(function (queued) {
      port.postMessage(queued);
    });
    resolveReady();
  }
  window.addEventListener('message', onWindowMessage);
  window.parent.postMessage(
    { source: 'genesis-preview', type: 'hello', protocol: 1, nonce: NONCE },
    '*',
  );

  // ── RPC ──
  function rpc(method, params) {
    return ready.then(function () {
      return new Promise(function (resolve, reject) {
        sequence += 1;
        var id = 'r' + sequence;
        var timer = setTimeout(function () {
          pending.delete(id);
          reject(GenesisError('PREVIEW_TIMEOUT', 'HighLevel call timed out.', true));
        }, TIMEOUT_MS);
        pending.set(id, { resolve: resolve, reject: reject, timer: timer });
        try {
          port.postMessage({
            type: 'rpc',
            id: id,
            method: method,
            params: params === undefined ? {} : params,
          });
        } catch (e) {
          pending.delete(id);
          clearTimeout(timer);
          reject(
            GenesisError(
              'VALIDATION_FAILED',
              'Parameters must be plain data (no functions or DOM nodes).',
              false,
            ),
          );
        }
      });
    });
  }

  var highlevel = {};
  METHODS.forEach(function (name) {
    var parts = name.split('.');
    highlevel[parts[0]] = highlevel[parts[0]] || {};
    highlevel[parts[0]][parts[1]] = function (params) {
      return rpc(name, params);
    };
  });
  Object.keys(highlevel).forEach(function (area) {
    Object.freeze(highlevel[area]);
  });
  Object.freeze(highlevel);

  function on(name, handler) {
    if (EVENTS.indexOf(name) === -1 || typeof handler !== 'function') {
      throw new TypeError('genesis.on: unknown event "' + name + '"');
    }
    if (!handlers.has(name)) handlers.set(name, new Set());
    handlers.get(name).add(handler);
    return function () {
      handlers.get(name).delete(handler);
    };
  }

  var api = Object.freeze({
    version: '1',
    ready: ready,
    get context() {
      return context;
    },
    highlevel: highlevel,
    on: on,
    GenesisError: GenesisError,
  });
  Object.defineProperty(window, 'genesis', {
    value: api,
    writable: false,
    configurable: false,
    enumerable: true,
  });
})(window);
```

- [ ] **Step 3: Run** → PASS (the method list is asserted equal to `RUNTIME_METHOD_NAMES`, so the manifest and the runtime cannot drift). **Commit** — `feat(frontend): add preview runtime SDK v1`

---

### Task FE-6.3: Host bridge and runtime API client

**Files:**
- Create: `frontend/src/features/workspace/preview/host-bridge.ts`, `frontend/src/services/api/hl-runtime.api.ts`
- Test: `frontend/tests/features/workspace/preview/host-bridge.test.ts`, `frontend/tests/services/api/hl-runtime.api.test.ts`

**Interfaces:** Produces `class PreviewHostBridge({ getContext, invoke, onLog, onCall, now?, win?, createChannel? })` with `attach(frame: () => HTMLIFrameElement | null, nonce)`, `detach()`, `pushEvent(name, payload)`; `BridgeCall`, `BridgeLog`; `buildRuntimeRequest(projectId, method, params)`, `invokeRuntime(projectId, method, params, signal)` (A5–A15).

Budgets (`contracts/limits.ts`): ≤ 6 in flight, ≤ 120 calls/min, ≤ 10 writes/min, params ≤ 64 KB, 20 s timeout → `PREVIEW_LIMIT` / `PREVIEW_TIMEOUT` / `VALIDATION_FAILED` / `UNKNOWN_METHOD`. The server validates again (it is the authority); the bridge exists to fail fast, protect quota and keep credentials out of the iframe.

- [ ] **Step 1: Failing tests**

`frontend/tests/features/workspace/preview/host-bridge.test.ts`:
```ts
import type { PreviewContext } from '@/contracts/bridge';
import { PreviewHostBridge, type BridgeCall } from '@/features/workspace/preview/host-bridge';
import { ApiError } from '@/lib/http';

const context: PreviewContext = {
  location: null,
  project: { id: 'p1', name: 'P' },
  hlStatus: 'disconnected',
};

function setup(invoke = vi.fn().mockResolvedValue({ items: [] })) {
  let listener: ((e: MessageEvent) => void) | null = null;
  const win = {
    addEventListener: (_t: 'message', fn: (e: MessageEvent) => void) => (listener = fn),
    removeEventListener: () => (listener = null),
  };
  const child = { postMessage: vi.fn() };
  const frame = { contentWindow: child } as unknown as HTMLIFrameElement;
  const port1 = {
    postMessage: vi.fn(),
    onmessage: null as ((e: MessageEvent) => void) | null,
    close: vi.fn(),
  };
  const calls: BridgeCall[] = [];
  const bridge = new PreviewHostBridge({
    getContext: () => context,
    invoke,
    onLog: vi.fn(),
    onCall: (c) => calls.push(c),
    win,
    createChannel: () => ({ port1, port2: {} as Transferable }),
  });
  bridge.attach(() => frame, 'n0nce123');
  const hello = (nonce = 'n0nce123', source: unknown = child) =>
    listener?.({
      source,
      data: { source: 'genesis-preview', type: 'hello', protocol: 1, nonce },
    } as unknown as MessageEvent);
  const rpc = async (method: string, params: unknown, id = 'r1') => {
    port1.onmessage?.({ data: { type: 'rpc', id, method, params } } as MessageEvent);
    await new Promise((r) => setTimeout(r, 0));
    return port1.postMessage.mock.calls.at(-1)?.[0] as Record<string, unknown>;
  };
  return { bridge, child, port1, hello, rpc, calls, invoke };
}

describe('PreviewHostBridge', () => {
  it('hands a port only to its own iframe with the current nonce', () => {
    const { child, hello } = setup();
    hello('n0nce123', {});
    hello('wrong');
    expect(child.postMessage).not.toHaveBeenCalled();
    hello();
    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'init', nonce: 'n0nce123', context }),
      '*',
      [{}],
    );
  });

  it('validates, invokes and answers RPCs', async () => {
    const { hello, rpc, invoke, calls } = setup();
    hello();
    expect(await rpc('contacts.list', { limit: '5' })).toEqual({
      type: 'rpc-result',
      id: 'r1',
      ok: true,
      result: { items: [] },
    });
    expect(invoke).toHaveBeenCalledWith('contacts.list', { limit: 5 }, expect.any(AbortSignal));
    expect(calls[0]).toMatchObject({ method: 'contacts.list', ok: true, code: null });
  });

  it('rejects unknown methods and invalid params without calling the API', async () => {
    const { hello, rpc, invoke } = setup();
    hello();
    expect(await rpc('contacts.deleteAll', {})).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_METHOD' },
    });
    expect(await rpc('calendars.events', { from: 'yesterday', to: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('enforces the write budget', async () => {
    const { hello, rpc } = setup(vi.fn().mockResolvedValue({ id: 'c' }));
    hello();
    for (let i = 0; i < 10; i += 1) await rpc('contacts.create', { firstName: 'A' }, `w${i}`);
    expect(await rpc('contacts.create', { firstName: 'A' }, 'w10')).toMatchObject({
      ok: false,
      error: { code: 'PREVIEW_LIMIT', retryable: true },
    });
  });

  it('passes API errors through as { code, message, retryable }', async () => {
    const { hello, rpc } = setup(
      vi
        .fn()
        .mockRejectedValue(
          new ApiError({
            code: 'HL_REAUTH_REQUIRED',
            message: 'Your HighLevel connection expired — reconnect.',
            status: 409,
            retryable: false,
          }),
        ),
    );
    hello();
    expect(await rpc('location.get', {})).toMatchObject({
      ok: false,
      error: { code: 'HL_REAUTH_REQUIRED', retryable: false },
    });
  });
});
```

`frontend/tests/services/api/hl-runtime.api.test.ts`:
```ts
import { buildRuntimeRequest } from '@/services/api/hl-runtime.api';

describe('buildRuntimeRequest', () => {
  it('maps reads to GET with path params and query', () => {
    expect(
      buildRuntimeRequest('p1', 'calendars.freeSlots', { calendarId: 'cal 1', from: 'a', to: 'b' }),
    ).toEqual({
      method: 'GET',
      path: '/v1/projects/p1/hl/calendars/cal%201/free-slots',
      query: { from: 'a', to: 'b' },
    });
  });
  it('maps writes to a JSON body without path params', () => {
    expect(
      buildRuntimeRequest('p1', 'contacts.update', { contactId: 'c1', firstName: 'Ava' }),
    ).toEqual({
      method: 'PATCH',
      path: '/v1/projects/p1/hl/contacts/c1',
      body: { firstName: 'Ava' },
    });
  });
  it('refuses a missing path parameter', () => {
    expect(() => buildRuntimeRequest('p1', 'contacts.get', {})).toThrow(/contactId/);
  });
});
```

- [ ] **Step 2: Implement**

`frontend/src/services/api/hl-runtime.api.ts`:
```ts
import { RUNTIME_METHODS, pathParamNames, type RuntimeMethodName } from '@/contracts/hl-runtime';
import { apiFetch, type QueryParams } from '@/lib/http';

export interface RuntimeRequest {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  query?: QueryParams;
  body?: Record<string, unknown>;
}

/** Maps a runtime SDK call onto its REST route (07 §3.1 A5–A15) using the shared manifest. */
export function buildRuntimeRequest(
  projectId: string,
  method: RuntimeMethodName,
  params: Readonly<Record<string, unknown>>,
): RuntimeRequest {
  const spec = RUNTIME_METHODS[method];
  const rest: Record<string, unknown> = { ...params };
  let path: string = spec.path;
  for (const name of pathParamNames(spec.path)) {
    const value = rest[name];
    if (typeof value !== 'string' || value === '')
      throw new Error(`Missing path parameter "${name}" for ${method}`);
    path = path.replace(`:${name}`, encodeURIComponent(value));
    delete rest[name];
  }
  const url = `/v1/projects/${encodeURIComponent(projectId)}${path}`;
  if (spec.verb === 'GET') {
    const query: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        query[key] = value;
    }
    return { method: 'GET', path: url, query };
  }
  return { method: spec.verb, path: url, body: rest };
}

export function invokeRuntime(
  projectId: string,
  method: RuntimeMethodName,
  params: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
): Promise<unknown> {
  const req = buildRuntimeRequest(projectId, method, params);
  return apiFetch<unknown>('api', req.path, {
    method: req.method,
    query: req.query,
    body: req.body,
    signal,
  });
}
```

`frontend/src/features/workspace/preview/host-bridge.ts`:
```ts
import {
  BRIDGE_PROTOCOL_VERSION,
  HelloMessageSchema,
  PortInboundSchema,
  type HostEventMessage,
  type InitMessage,
  type PreviewContext,
  type RpcErrorPayload,
  type RpcResultMessage,
} from '@/contracts/bridge';
import { defaultMessage } from '@/contracts/errors';
import {
  RUNTIME_METHODS,
  RUNTIME_METHOD_NAMES,
  type RuntimeEventName,
  type RuntimeMethodName,
} from '@/contracts/hl-runtime';
import { LIMITS } from '@/contracts/limits';
import { toUserMessage } from '@/lib/errors';
import { isApiError } from '@/lib/http';

export interface BridgeCall {
  id: string;
  method: string;
  ms: number;
  ok: boolean;
  code: string | null;
  at: number;
}

export interface BridgeLog {
  level: 'log' | 'info' | 'warn' | 'error';
  text: string;
  at: number;
}

interface PortLike {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
}

interface WindowLike {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

export interface HostBridgeDeps {
  getContext: () => PreviewContext;
  invoke: (
    method: RuntimeMethodName,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<unknown>;
  onLog: (entry: BridgeLog) => void;
  onCall: (call: BridgeCall) => void;
  now?: () => number;
  win?: WindowLike;
  createChannel?: () => { port1: PortLike; port2: Transferable };
}

const MINUTE = 60_000;
const isMethod = (m: string): m is RuntimeMethodName =>
  (RUNTIME_METHOD_NAMES as readonly string[]).includes(m);
const rpcError = (code: string, message: string, retryable = false): RpcErrorPayload => ({
  code,
  message,
  retryable,
});

/**
 * The host side of preview bridge protocol v1 (07 §3.3). The iframe gets capabilities, never
 * credentials: every call is allow-listed, schema-checked and budgeted here, then made with the
 * user's ID token by the SPA.
 */
export class PreviewHostBridge {
  private frame: (() => HTMLIFrameElement | null) | null = null;
  private nonce: string | null = null;
  private port: PortLike | null = null;
  private inFlight = 0;
  private calls: number[] = [];
  private writes: number[] = [];
  private readonly controllers = new Set<AbortController>();
  private readonly listener = (event: MessageEvent): void => this.onWindowMessage(event);

  constructor(private readonly deps: HostBridgeDeps) {}

  private get now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private get win(): WindowLike {
    return this.deps.win ?? window;
  }

  /** Call before the iframe document loads; the frame is resolved lazily at handshake time. */
  attach(frame: () => HTMLIFrameElement | null, nonce: string): void {
    this.detach();
    this.frame = frame;
    this.nonce = nonce;
    this.win.addEventListener('message', this.listener);
  }

  detach(): void {
    this.win.removeEventListener('message', this.listener);
    this.port?.close();
    this.port = null;
    this.frame = null;
    this.nonce = null;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.inFlight = 0;
  }

  /** Bonus: forwards HighLevel webhook events to `genesis.on(...)` handlers. */
  pushEvent(name: RuntimeEventName, payload: Record<string, unknown>): void {
    const message: HostEventMessage = { type: 'event', name, payload };
    this.port?.postMessage(message);
  }

  private onWindowMessage(event: MessageEvent): void {
    const frame = this.frame?.();
    if (!frame || this.port || event.source !== frame.contentWindow || !this.nonce) return;
    const hello = HelloMessageSchema.safeParse(event.data);
    if (!hello.success || hello.data.nonce !== this.nonce) return;

    const channel = this.deps.createChannel?.() ?? new MessageChannel();
    const port: PortLike = channel.port1;
    this.port = port;
    port.onmessage = (message: MessageEvent) => void this.onPortMessage(message.data);
    const init: InitMessage = {
      source: 'genesis-host',
      type: 'init',
      protocol: BRIDGE_PROTOCOL_VERSION,
      nonce: this.nonce,
      context: this.deps.getContext(),
    };
    frame.contentWindow?.postMessage(init, '*', [channel.port2]);
  }

  private async onPortMessage(data: unknown): Promise<void> {
    const parsed = PortInboundSchema.safeParse(data);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === 'console') {
      this.deps.onLog({ level: message.level, text: message.args.join(' '), at: this.now });
      return;
    }
    if (message.type === 'runtime-error') {
      this.deps.onLog({
        level: 'error',
        text: message.stack ? `${message.message}\n${message.stack}` : message.message,
        at: this.now,
      });
      return;
    }
    await this.handleRpc(message.id, message.method, message.params);
  }

  private budgetError(write: boolean): RpcErrorPayload | null {
    const now = this.now;
    this.calls = this.calls.filter((t) => t > now - MINUTE);
    this.writes = this.writes.filter((t) => t > now - MINUTE);
    const over =
      this.inFlight >= LIMITS.bridgeMaxInFlight ||
      this.calls.length >= LIMITS.bridgeCallsPerMinute ||
      (write && this.writes.length >= LIMITS.bridgeWritesPerMinute);
    if (over) return rpcError('PREVIEW_LIMIT', defaultMessage('PREVIEW_LIMIT'), true);
    this.calls.push(now);
    if (write) this.writes.push(now);
    return null;
  }

  private async handleRpc(id: string, method: string, params: unknown): Promise<void> {
    const port = this.port;
    const started = this.now;
    const finish = (result: RpcResultMessage): void => {
      if (this.port === port) port?.postMessage(result); // drop replies for a replaced document
      this.deps.onCall({
        id,
        method,
        ms: this.now - started,
        ok: result.ok,
        code: result.ok ? null : result.error.code,
        at: started,
      });
    };
    const fail = (error: RpcErrorPayload): void =>
      finish({ type: 'rpc-result', id, ok: false, error });

    if (!isMethod(method))
      return fail(rpcError('UNKNOWN_METHOD', defaultMessage('UNKNOWN_METHOD')));
    let size: number;
    try {
      size = JSON.stringify(params ?? {}).length;
    } catch {
      return fail(rpcError('VALIDATION_FAILED', 'Parameters must be plain data.'));
    }
    if (size > LIMITS.bridgeMaxParamsBytes)
      return fail(rpcError('VALIDATION_FAILED', 'Parameters are too large.'));
    const spec = RUNTIME_METHODS[method];
    const valid = spec.params.safeParse(params ?? {});
    if (!valid.success) {
      const issue = valid.error.issues[0];
      const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
      return fail(
        rpcError('VALIDATION_FAILED', `${where}${issue?.message ?? 'Invalid parameters.'}`),
      );
    }
    const over = this.budgetError(spec.write);
    if (over) return fail(over);

    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), LIMITS.bridgeCallTimeoutMs);
    this.inFlight += 1;
    try {
      const result = await this.deps.invoke(method, valid.data, controller.signal);
      finish({ type: 'rpc-result', id, ok: true, result });
    } catch (error) {
      if (controller.signal.aborted)
        fail(rpcError('PREVIEW_TIMEOUT', defaultMessage('PREVIEW_TIMEOUT'), true));
      else if (isApiError(error)) fail(rpcError(error.code, toUserMessage(error), error.retryable));
      else fail(rpcError('INTERNAL', defaultMessage('INTERNAL'), true));
    } finally {
      clearTimeout(timer);
      this.inFlight = Math.max(0, this.inFlight - 1);
      this.controllers.delete(controller);
    }
  }
}
```

- [ ] **Step 3: Run** → PASS. **Commit** — `feat(frontend): add preview host bridge with allow-list and budgets`

---

### Task FE-6.4: Preview panel

**Files:**
- Create: `frontend/src/features/workspace/preview/PreviewFrame.vue`, `PreviewToolbar.vue`, `PreviewConsole.vue`, `PreviewPanel.vue`, `frontend/src/services/firestore/events.repo.ts`, `frontend/src/features/workspace/composables/usePreviewEvents.ts` (webhook relay — FE-8.5; create it now as shown, it is inert until the backend writes events)

**Interfaces:** `PreviewPanel` compiles from **committed** files only and rebuilds (new nonce, new iframe) when the committed file set changes (debounced 150 ms) or on Reload — so it updates after generation commit, manual save and restore, never while tokens stream (R-FE5).

- [ ] **Step 1: Implement**

`frontend/src/features/workspace/preview/PreviewFrame.vue`:
```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { PREVIEW_SANDBOX } from './preview-csp';

const props = defineProps<{ html: string }>();
const emit = defineEmits<{ ready: [element: HTMLIFrameElement]; navigated: [] }>();
const frame = ref<HTMLIFrameElement | null>(null);
let loads = 0;

/**
 * CSP cannot stop a document from navigating its own frame. The first load is our srcdoc;
 * any later load means the app navigated away, so the panel rebuilds it.
 */
function onLoad(): void {
  loads += 1;
  if (loads > 1) emit('navigated');
}

onMounted(() => {
  if (frame.value) emit('ready', frame.value);
});
</script>

<template>
  <iframe
    ref="frame"
    :srcdoc="props.html"
    :sandbox="PREVIEW_SANDBOX"
    referrerpolicy="no-referrer"
    title="App preview"
    class="size-full border-0 bg-white"
    @load="onLoad"
  />
</template>
```

`frontend/src/features/workspace/preview/PreviewToolbar.vue`:
```vue
<script setup lang="ts">
import { RefreshCwIcon, TerminalIcon } from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const props = defineProps<{ label: string; errorCount: number; consoleOpen: boolean }>();
const emit = defineEmits<{ reload: []; 'toggle-console': [] }>();
</script>

<template>
  <div class="flex h-9 items-center gap-2 border-b px-3 text-xs">
    <span class="truncate text-muted-foreground" role="status">{{ props.label }}</span>
    <div class="ml-auto flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Reload preview"
            @click="emit('reload')"
          >
            <RefreshCwIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reload preview</TooltipContent>
      </Tooltip>
      <Button
        variant="ghost"
        size="sm"
        :aria-pressed="props.consoleOpen"
        aria-label="Toggle console"
        @click="emit('toggle-console')"
      >
        <TerminalIcon />Console
        <Badge v-if="props.errorCount" variant="destructive" class="h-4 px-1 tabular-nums">{{
          props.errorCount
        }}</Badge>
      </Button>
    </div>
  </div>
</template>
```

`frontend/src/features/workspace/preview/PreviewConsole.vue`:
```vue
<script setup lang="ts">
import { EraserIcon } from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { BridgeCall, BridgeLog } from './host-bridge';

const props = defineProps<{ logs: BridgeLog[]; calls: BridgeCall[] }>();
const emit = defineEmits<{ clear: [] }>();
const time = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour12: false });
</script>

<template>
  <Tabs default-value="console" class="flex h-56 flex-col gap-0 border-t">
    <div class="flex items-center border-b px-2">
      <TabsList class="h-8 bg-transparent">
        <TabsTrigger value="console" class="text-xs">Console</TabsTrigger>
        <TabsTrigger value="calls" class="text-xs">HighLevel calls</TabsTrigger>
      </TabsList>
      <Button
        variant="ghost"
        size="icon-xs"
        class="ml-auto"
        aria-label="Clear"
        @click="emit('clear')"
      >
        <EraserIcon />
      </Button>
    </div>
    <TabsContent value="console" class="min-h-0 flex-1">
      <ScrollArea class="h-full">
        <p v-if="!props.logs.length" class="p-3 text-xs text-muted-foreground">
          No console output yet.
        </p>
        <pre
          v-for="(log, i) in props.logs"
          :key="i"
          :class="
            cn('border-b px-3 py-1 font-mono text-[11px] whitespace-pre-wrap', {
              'text-destructive': log.level === 'error',
              'text-warning': log.level === 'warn',
            })
          "
        ><span class="text-muted-foreground">{{ time(log.at) }} </span>{{ log.text }}</pre>
      </ScrollArea>
    </TabsContent>
    <TabsContent value="calls" class="min-h-0 flex-1">
      <ScrollArea class="h-full">
        <p v-if="!props.calls.length" class="p-3 text-xs text-muted-foreground">
          No HighLevel calls yet.
        </p>
        <div
          v-for="call in props.calls"
          :key="call.id + call.at"
          class="flex items-center gap-3 border-b px-3 py-1 font-mono text-[11px]"
        >
          <span class="text-muted-foreground">{{ time(call.at) }}</span>
          <span class="truncate">{{ call.method }}</span>
          <span class="ml-auto tabular-nums text-muted-foreground">{{ call.ms }} ms</span>
          <Badge :variant="call.ok ? 'outline' : 'destructive'" class="text-[10px]">{{
            call.ok ? 'ok' : call.code
          }}</Badge>
        </div>
      </ScrollArea>
    </TabsContent>
  </Tabs>
</template>
```

`frontend/src/services/firestore/events.repo.ts`:
```ts
import { orderBy, query, Timestamp, where, type Query } from 'firebase/firestore';
import { refs } from './paths';
import type { UserEvent } from './types';

/** Webhook events (bonus) created after this session opened; TTL deletes them after 24 h. */
export const recentEventsQuery = (uid: string, sinceMs: number): Query<UserEvent> =>
  query(
    refs.events(uid),
    where('createdAt', '>', Timestamp.fromMillis(sinceMs)),
    orderBy('createdAt', 'asc'),
  );
```

`frontend/src/features/workspace/composables/usePreviewEvents.ts`:
```ts
import { watch } from 'vue';
import { RUNTIME_EVENT_NAMES, type RuntimeEventName } from '@/contracts/hl-runtime';
import { useFirestoreQuery } from '@/composables/useFirestoreQuery';
import { recentEventsQuery } from '@/services/firestore/events.repo';
import type { PreviewHostBridge } from '../preview/host-bridge';
import { useWorkspace } from '../workspace-context';

const isEventName = (v: string): v is RuntimeEventName =>
  (RUNTIME_EVENT_NAMES as readonly string[]).includes(v);

/** Bonus R-B6: relays HighLevel webhook events for this project's location into the running preview. */
export function usePreviewEvents(bridge: PreviewHostBridge): void {
  const ws = useWorkspace();
  const since = Date.now();
  const delivered = new Set<string>();
  const { data } = useFirestoreQuery(() => recentEventsQuery(ws.uid, since));

  watch(data, (events) => {
    const locationId = ws.project.value?.locationId ?? null;
    for (const event of events) {
      if (delivered.has(event.id)) continue;
      delivered.add(event.id);
      if (locationId !== null && event.locationId === locationId && isEventName(event.type)) {
        bridge.pushEvent(event.type, event.payload);
      }
    }
  });
}
```

`frontend/src/features/workspace/preview/PreviewPanel.vue`:
```vue
<script setup lang="ts">
import { PlugIcon } from '@lucide/vue';
import { refDebounced } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import PageState from '@/components/common/PageState.vue';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { PreviewContext } from '@/contracts/bridge';
import { useHighLevelConnection } from '@/features/highlevel/useHighLevelConnection';
import { newNonce } from '@/lib/ids';
import { invokeRuntime } from '@/services/api/hl-runtime.api';
import { usePreviewEvents } from '../composables/usePreviewEvents';
import { useWorkspaceStore } from '../stores/workspace.store';
import { useWorkspace } from '../workspace-context';
import { compilePreview } from './compile-preview';
import { PreviewHostBridge, type BridgeCall, type BridgeLog } from './host-bridge';
import PreviewConsole from './PreviewConsole.vue';
import PreviewFrame from './PreviewFrame.vue';
import PreviewToolbar from './PreviewToolbar.vue';
import runtimeSource from './runtime/genesis-runtime.js?raw';

const MAX_LOGS = 500;
const MAX_CALLS = 200;

const ws = useWorkspace();
const workspace = useWorkspaceStore();
const { previewNonce, consoleOpen } = storeToRefs(workspace);
const hl = useHighLevelConnection();

const logs = shallowRef<BridgeLog[]>([]);
const calls = shallowRef<BridgeCall[]>([]);
const errorCount = computed(() => logs.value.filter((l) => l.level === 'error').length);
const frameElement = shallowRef<HTMLIFrameElement | null>(null);

function context(): PreviewContext {
  const project = ws.project.value;
  const linked = hl.status.value === 'connected' && hl.locationId.value !== null;
  return {
    location: linked
      ? {
          id: hl.locationId.value ?? '',
          name: hl.locationName.value ?? '',
          timezone: hl.timezone.value,
        }
      : null,
    project: { id: ws.projectId, name: project?.name ?? '' },
    hlStatus: hl.status.value === 'loading' ? 'disconnected' : hl.status.value,
  };
}

const bridge = new PreviewHostBridge({
  getContext: context,
  invoke: (method, params, signal) => invokeRuntime(ws.projectId, method, params, signal),
  onLog: (entry) => (logs.value = [...logs.value, entry].slice(-MAX_LOGS)),
  onCall: (call) => (calls.value = [...calls.value, call].slice(-MAX_CALLS)),
});
usePreviewEvents(bridge);

// Only committed files feed the preview: it rebuilds after a generation commit, a save or a
// restore — never while tokens stream or from unsaved buffers (R-FE5).
const fingerprint = computed(() =>
  ws.files.value
    .map((f) => `${f.path}:${f.contentHash}`)
    .sort()
    .join('|'),
);
const settled = refDebounced(fingerprint, 150);
const nonce = ref(newNonce());
const rebuilding = computed(() => settled.value !== fingerprint.value);

watch([settled, previewNonce], () => {
  nonce.value = newNonce();
});

const compiled = computed(() =>
  compilePreview({ files: ws.files.value, runtimeSource, nonce: nonce.value }),
);

watch(
  nonce,
  (value) => {
    logs.value = [];
    bridge.attach(() => frameElement.value, value);
  },
  { immediate: true },
);
onBeforeUnmount(() => bridge.detach());

const snapshotSeq = computed(() => ws.project.value?.snapshotSeq ?? 0);
const label = computed(() => {
  if (rebuilding.value) return 'Rebuilding…';
  if (!compiled.value.html) return 'Waiting for the first generation';
  const edits = ws.project.value?.workingTreeDirty ? ' + saved edits' : '';
  return snapshotSeq.value > 0 ? `Live · snapshot #${snapshotSeq.value}${edits}` : `Live${edits}`;
});
const mismatch = computed(() => {
  const projectLocation = ws.project.value?.locationId ?? null;
  return (
    projectLocation !== null &&
    hl.locationId.value !== null &&
    projectLocation !== hl.locationId.value
  );
});

function onNavigated(): void {
  logs.value = [
    ...logs.value,
    {
      level: 'warn',
      text: 'The app navigated away from itself; the preview was reloaded.',
      at: Date.now(),
    },
  ];
  workspace.reloadPreview();
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col" aria-label="Preview">
    <PreviewToolbar
      :label="label"
      :error-count="errorCount"
      :console-open="consoleOpen"
      @reload="workspace.reloadPreview()"
      @toggle-console="consoleOpen = !consoleOpen"
    />
    <Alert
      v-if="hl.status.value !== 'connected' && hl.status.value !== 'loading' && compiled.html"
      class="m-2 w-auto"
    >
      <PlugIcon />
      <AlertTitle>HighLevel isn't connected</AlertTitle>
      <AlertDescription class="flex flex-wrap items-center gap-2">
        The app runs, but its data calls fail until you connect.
        <Button size="xs" variant="outline" @click="hl.connect(`/projects/${ws.projectId}`)"
          >Connect</Button
        >
      </AlertDescription>
    </Alert>
    <Alert v-else-if="mismatch" class="m-2 w-auto">
      <AlertTitle>This project belongs to another HighLevel location</AlertTitle>
      <AlertDescription
        >Data calls return an error until you reconnect that location.</AlertDescription
      >
    </Alert>
    <Alert v-if="compiled.issues.length && compiled.html" class="m-2 w-auto">
      <AlertTitle>Preview build notes</AlertTitle>
      <AlertDescription>
        <ul class="list-disc pl-4">
          <li v-for="issue in compiled.issues" :key="issue.message">{{ issue.message }}</li>
        </ul>
      </AlertDescription>
    </Alert>
    <div class="relative min-h-0 flex-1 bg-muted/30">
      <PreviewFrame
        v-if="compiled.html"
        :key="nonce"
        :html="compiled.html"
        @ready="frameElement = $event"
        @navigated="onNavigated"
      />
      <PageState
        v-else-if="!ws.filesLoading.value"
        kind="empty"
        title="Your app will appear here"
        description="Describe what you want in the chat. The preview runs it on your HighLevel data."
      />
      <PageState v-else kind="loading" title="Loading files" />
    </div>
    <PreviewConsole
      v-if="consoleOpen"
      :logs="logs"
      :calls="calls"
      @clear="
        logs = [];
        calls = [];
      "
    />
  </section>
</template>
```

- [ ] **Step 2: Verify with real data** (HighLevel sandbox seeded per prerequisites §5.3; connection via OAuth or `seed:pit`): generate "Contact dashboard with search and upcoming appointments" → the preview lists the sandbox contacts and appointments; "HighLevel calls" shows `contacts.list … ok`. In the iframe's DevTools console: `document.cookie` → `""`, `localStorage.getItem('x')` → `null` (shim), `fetch('https://example.com')` → blocked by CSP. Disconnect HighLevel → the app shows `HL_NOT_CONNECTED` errors and the panel offers Connect.

- [ ] **Step 3: Commit** — `feat(frontend): add live preview panel with console and HighLevel call log`
