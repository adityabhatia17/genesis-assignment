# Research 05 — Frontend stack: versions, shadcn-vue, Monaco, SSE, preview sandbox

**Date:** 2026-09-26
**Sources:** npm registry metadata and peer-dependency ranges (queried 2026-09-26), shadcn-vue docs + `shadcn-vue@2.8.2` CLI help, `@guolao/vue-monaco-editor` README, `monaco-editor@0.57.0` package layout, `eventsource-parser@4.1.1` README, HTML/CSP specs (sandboxed iframes, `srcdoc` policy inheritance), MDN (`MessageChannel`, `sandbox`).
**Purpose:** Lock versions that actually work together in September 2026 and record the browser facts the preview's security depends on.

---

## 1. Version and compatibility matrix

| Package | Version | Constraint that matters |
|---|---|---|
| Node (local + CI) | **24.x** | `@vitejs/plugin-vue` needs `^20.19 \|\| >=22.12`; Vitest 5 needs `^22.12 \|\| ^24` |
| `vue` | 3.5.43 | — |
| `vite` | 8.3.1 | `@vitejs/plugin-vue` 6 and `@tailwindcss/vite` 4 support Vite 8 |
| `typescript` | **5.9.3** (not 7.x) | `typescript-eslint` peer range is `>=4.8.4 <6.1.0`; TypeScript 7 (native compiler) breaks linting |
| `vue-tsc` | 3.3.11 | `typescript >=5.0.0` |
| `pinia` | 4.0.3 | Vue `^3.5.11`, TS `>=5.6` |
| `vue-router` | 5.3.1 | Peers: Vite `^7.3 \|\| ^8`, Pinia `^3.0.4 \|\| ^4.0.2` |
| `tailwindcss` + `@tailwindcss/vite` | 4.3.3 | CSS-first config (no `tailwind.config.js`) |
| `shadcn-vue` (CLI) | 2.8.2 | Built on **reka-ui 2.10.5**; `init -t vite --base reka` |
| `@lucide/vue` | 1.48 | Icon package shadcn-vue 2.8 installs for `--icon-library lucide` (not the older `lucide-vue-next`) — corrected during plan verification |
| `vue-sonner` | 2.0.9 | Toasts (shadcn-vue `sonner` component) |
| `@vueuse/core` | 15.0.0 | `useColorMode`, `useEventListener`, `useOnline`, `useLocalStorage` |
| `zod` | **4.6.5** | Shared with functions via generated contracts. `@vee-validate/zod` requires zod `^3.24` → **no vee-validate**; forms use a 40-line `useZodForm` composable with shadcn-vue `Field` components |
| `firebase` | 12.19.0 | Modular SDK |
| `@guolao/vue-monaco-editor` | 1.6.0 | Peer `monaco-editor >=0.43` |
| `monaco-editor` | 0.57.0 | Bundled locally (no CDN) |
| `eventsource-parser` | 4.1.1 | Spec-compliant SSE framing parser |
| `vitest` | 5.0.2 | + `happy-dom` 20.x, `@vue/test-utils` 2.5.1 |
| `eslint` | 10.11 | + `typescript-eslint` 8.70, `eslint-plugin-vue` 10.11, `eslint-config-prettier` |
| `prettier` | 3.9.9 | — |

Same TypeScript (5.9.3), zod (4.6.5), ESLint and Vitest majors are used in `functions/` so the generated contracts compile identically on both sides.

## 2. shadcn-vue

- Setup on Vite: create the Vue-TS app → add `tailwindcss` + `@tailwindcss/vite` → `@` alias in `vite.config.ts` and `tsconfig` paths → `npx shadcn-vue@2.8.2 init -t vite --base reka --icon-library lucide -b neutral` → `npx shadcn-vue@2.8.2 add <components…>`.
- Components are **copied into `src/components/ui/`** (owned code, themable, tree-shaken). `components.json` records aliases (`@/components`, `@/components/ui`, `@/lib/utils`, `@/composables`).
- Components Genesis uses and where:

| Component | Used for |
|---|---|
| `button`, `input`, `label`, `textarea`, `field` | Auth forms, project dialog, prompt composer |
| `card` | Auth card, project cards, connection card |
| `dialog`, `alert-dialog` | Create/edit project, delete confirm, restore confirm, save-conflict, diff viewer |
| `sheet` | **Snapshot history** (R-FE7) |
| `tabs` | **Editor tabs** (R-FE4), mobile workspace tabs |
| `badge` | Connection status, snapshot kinds, file status |
| `resizable` | Three-panel workspace (`ResizablePanelGroup` / `ResizablePanel` / `ResizableHandle`, persisted sizes) |
| `scroll-area` | Chat history, file tree, snapshot list, preview console |
| `dropdown-menu`, `avatar` | User menu, project card actions |
| `tooltip` | Icon buttons, absolute timestamps |
| `sonner` | Toasts (connected, saved, restored, errors) |
| `skeleton`, `spinner`, `empty`, `alert` | Loading, empty and error states |
| `collapsible` | "Planning…" thinking disclosure |
| `select` | Diff file picker (bonus) |
| `separator` | Layout |

## 3. Monaco via `@guolao/vue-monaco-editor`

- Default loader fetches Monaco from jsDelivr. We **bundle locally**: `import * as monaco from 'monaco-editor'; loader.config({ monaco })` and define workers with Vite `?worker` imports. Since 0.56 the package has an `exports` map rooted at `esm/vs/`, so the classic `monaco-editor/esm/vs/...` specifiers **no longer resolve** (corrected during plan verification). The worker entry points are:
  - `monaco-editor/editor/editor.worker?worker`
  - `monaco-editor/language/css/css.worker?worker`
  - `monaco-editor/language/html/html.worker?worker`
  - `monaco-editor/language/typescript/ts.worker?worker` (JavaScript features)
  - `monaco-editor/language/json/json.worker?worker`
- 0.56 also added tree-shakeable entry points (`monaco-editor/editor`, `…/features/register.all`, `…/languages/definitions/<lang>/register`, `…/languages/features/<lang>/register`) — an optional bundle-size optimization (FE-8.3).
- `@guolao/vue-monaco-editor` disposes the model attached to the editor when the component unmounts; Genesis owns its models (`EditorModels`) and detaches them first (FE-5.4).
- Why local: works offline with emulators, no third-party runtime dependency, predictable versions.
- Monaco is several MB → load it only inside the lazily imported workspace route chunk.
- `<VueMonacoEditor>` props used: `path` (one model per file URI → per-file undo stack and view state), `language`, `default-value`, `options` (`readOnly`, `minimap`, `fontSize`, `wordWrap`, `automaticLayout`), `theme`, `@mount` (gives `editor` and `monaco`).
- **Streaming into the editor:** append with `model.applyEdits([{ range: endOfModel, text }])` (never `setValue` per token — O(n²) and resets the cursor). Coalesce deltas per animation frame. Auto-scroll with `editor.revealLine(lineCount)` only while "follow generation" is on.
- **Diff view (bonus):** `<VueMonacoDiffEditor original modified language>` ships in the same package — no extra `diff` dependency.

## 4. Consuming SSE from a POST

`EventSource` cannot send a POST body or an `Authorization` header, so the client uses `fetch()`:

```ts
const res = await fetch(url, { method: 'POST', headers, body, signal, cache: 'no-store' });
const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
const parser = createParser({ onEvent: (m) => handle(m.event, m.data, m.id) });
for (;;) { const { value, done } = await reader.read(); if (done) break; parser.feed(value); }
parser.reset({ consume: true });
```

`eventsource-parser` handles framing edge cases (events split across chunks, CRLF, multi-line `data:`, comments); our code owns only the domain protocol (zod-validated JSON payloads, ordering, terminal-event rules). A watchdog aborts when no bytes arrive for 45 s (server heartbeats every 15 s).

## 5. Preview sandbox — the browser facts security depends on

| Mechanism | Effect | Source of truth |
|---|---|---|
| `<iframe sandbox="allow-scripts" srcdoc="…">` **without** `allow-same-origin` | Document gets a unique **opaque origin**: no access to the parent DOM, cookies, `localStorage`/`sessionStorage`/IndexedDB (access throws `SecurityError`); no top navigation, popups or modal dialogs (`alert`/`confirm`/`prompt`) | HTML sandboxing |
| Forms in a sandbox | Without `allow-forms` the form-submission algorithm returns **before** the `submit` event fires, so `form.addEventListener('submit', …)` handlers never run. Genesis adds `allow-forms` and relies on CSP `form-action 'none'` to block actual submissions | HTML form submission algorithm |
| Self-navigation | A sandboxed document may still navigate **its own** frame (e.g. `location.href = …`); CSP has no directive for it | HTML navigation / CSP3 |
| Sandbox does **not** block network | `fetch`, `<img src>`, CSS `url()` to any host still work from an opaque origin → a token handed to the iframe **can be exfiltrated** | — |
| `<meta http-equiv="Content-Security-Policy">` placed **first** in `<head>` | Blocks network egress for everything after it: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'` | CSP3 (meta delivery; `frame-ancestors`/`report-uri`/`sandbox` not allowed in meta — not needed) |
| Multiple policies | All policies are enforced; generated HTML can add its own CSP but can only **tighten** | CSP3 |
| **Policy inheritance** | A `srcdoc` (and `about:blank`/`data:`/`blob:`) document **inherits the embedding page's CSP**. If the SPA served `script-src 'self'`, the preview's inline scripts would be blocked | HTML policy container |
| `MessageChannel` + `postMessage(msg, '*', [port])` | A private, transferable channel between parent and iframe; other frames cannot inject messages into it. Target origin must be `'*'` because the iframe origin is opaque; the parent authenticates the iframe by `event.source === iframe.contentWindow` plus a per-render nonce | HTML messaging |

Decisions that follow:
1. **The iframe never receives a credential** (no HighLevel token, no Firebase ID token). It calls `window.genesis.highlevel.*`, which sends RPC messages over its port; the **parent** validates and performs the authenticated call.
2. The iframe uses `sandbox="allow-scripts allow-forms"`. The compiled document starts with the network-blocking CSP meta, then the runtime SDK script, then the generated content.
3. Because of policy inheritance, the SPA must **not** send a restrictive `script-src` header. Genesis ships the other hardening headers (nosniff, referrer policy, `X-Frame-Options: DENY`, HSTS, permissions policy). "Serve the preview from a separate sandbox origin so the SPA can adopt a strict CSP" is a documented improvement.
4. `localStorage`/`sessionStorage` are shimmed with in-memory implementations by the runtime SDK so generated apps that use them do not crash.
5. This mirrors how HighLevel Custom Pages talk to their host (`postMessage` to the parent) — see `research/02` §9.

### 5.1 Why not Sandpack or WebContainers

| Option | Problem for Genesis |
|---|---|
| Sandpack | Bundles through CodeSandbox infrastructure (network, third-party runtime); solves JSX/npm bundling we don't need; conflicts with a no-network preview |
| WebContainers | Requires cross-origin isolation headers (COOP/COEP) on our app, heavy boot, commercial licensing terms; solves Node-in-browser we don't need |
| Blob/data URL iframe | Same policy inheritance as `srcdoc`, no advantage |
| Separate preview origin | Best isolation; extra hosting site and message plumbing — the upgrade path |

## 6. Firebase web SDK patterns

- Initialize once in `src/lib/firebase.ts`; connect emulators when `VITE_USE_EMULATORS=true`.
- Router guard: `await auth.authStateReady()` before deciding; `requiresAuth` / `guestOnly` meta.
- Realtime reads with `onSnapshot` wrapped in composables that unsubscribe on scope dispose; converters add `id` and type documents with the shared contracts (`ProjectDoc<Timestamp>`, …).
- Writes from the client are limited to project create/rename/soft-delete (rules-validated) with `serverTimestamp()`.

## 7. State boundaries

| State | Owner |
|---|---|
| Durable data (projects, files, messages, generations, snapshots, connection status) | Firestore listeners (single source of truth) |
| Live generation state (status machine, prose, thinking, per-file status, errors) | Pinia `generation` store; large text buffers kept **outside** reactivity |
| Workspace UI state (open tabs, active file, dirty paths, preview reload nonce, console open) | Pinia `workspace` store |
| Unsaved editor text | **Monaco models** (they survive tab switches and component unmounts); dirty = model text ≠ last synced content |
| Panel sizes, "follow generation" toggle | `localStorage` (via Resizable auto-save / VueUse) |

## 8. Testing tools

- Vitest 5 + happy-dom for units (SSE client, reducer, compiler, bridge, runtime SDK evaluated in a happy-dom window) and a handful of component tests (`@vue/test-utils`).
- Recorded SSE streams from the backend's fake provider are replayed at random chunk sizes to test the client exactly like the server parser was tested.
- Optional Playwright smoke test against emulators.
