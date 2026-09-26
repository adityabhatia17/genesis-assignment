# Genesis — Frontend System Design (Vue 3 SPA)

**Status:** Approved low-level design
**Date:** 2026-09-26
**Scope:** Everything under `frontend/`.
**Contracts:** REST, SSE, bridge, runtime SDK and Firestore schema are canonical in [`07-end-to-end-system-design.md`](07-end-to-end-system-design.md) §3.
**Plan:** [`09-frontend-implementation-plan/`](09-frontend-implementation-plan/00-overview.md) — its code is verified (typecheck, lint, 90 tests, build); where the plan and this document differ in detail, the plan is current.
**Visual design:** [`11-design-system.md`](11-design-system.md) (tokens, type, component states) and [`12-frontend-design-implementation.md`](12-frontend-design-implementation.md) (how they're wired into `main.css`, shadcn-vue and Monaco) — this document covers architecture; those cover appearance.

---

## 1. Principles

1. **Feature slices.** Code lives under `src/features/<feature>/`; shared primitives in `components/ui` (shadcn-vue) and `components/common`; framework-agnostic data access in `services/`; cross-cutting helpers in `lib/` and `composables/`.
2. **Components render, composables orchestrate, services talk to the outside world.** Components never call `fetch` or Firestore directly.
3. **One source of truth per kind of state** (see §5.4): Firestore for durable data, Pinia for ephemeral UI/generation state, Monaco models for unsaved text.
4. **Pure logic is extracted and unit-tested:** the generation reducer, SSE client framing, preview compiler, bridge policy, file-tree builder, error mapping.
5. **shadcn-vue for every UI primitive** (R-FE1). Monaco and the preview iframe are the only non-shadcn surfaces.
6. **Every surface has loading, empty and error states** (§15).
7. **TypeScript strict**, `<script setup lang="ts">`, typed `defineProps`/`defineEmits`, no `any`, named exports for TS modules, PascalCase components, `useX` composables, kebab-case non-component files.

## 2. Folder structure

The full repository tree is in [`04`](04-high-level-design.md) §10. Frontend responsibilities:

| Folder                    | Contents                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`                | `App.vue` (Toaster, theme, `RouterView`), `router.ts` (routes + guards), `layouts/AuthLayout.vue`, `layouts/AppLayout.vue`            |
| `src/components/ui/`      | shadcn-vue generated components (owned code; theming only)                                                                            |
| `src/components/common/`  | `AppHeader`, `UserMenu`, `ThemeToggle`, `PageState` (loading/empty/error presenter), `RelativeTime`, `OfflineBanner`, `ConfirmDialog` |
| `src/composables/`        | `useAuth`, `useFirestoreDoc`, `useFirestoreQuery`, `useZodForm`, `useTheme`, `useConfirm`                                             |
| `src/contracts/`          | **Generated** copy of `functions/src/contracts` (do not edit)                                                                         |
| `src/features/auth/`      | Sign-in/up pages, form, error mapping                                                                                                 |
| `src/features/highlevel/` | Connection card/badge, connection composable, OAuth return query handling                                                             |
| `src/features/projects/`  | Dashboard, project card, create/edit/delete dialogs, projects composable                                                              |
| `src/features/workspace/` | Workspace page/layout/header; `chat/`, `editor/`, `preview/`, `stores/`, `composables/`                                               |
| `src/features/snapshots/` | History sheet, restore dialog, snapshot composable                                                                                    |
| `src/lib/`                | `env`, `firebase`, `http`, `errors`, `utils` (`cn`), `ids`, `time`                                                                    |
| `src/services/firestore/` | Paths, converters, repositories (queries + client writes)                                                                             |
| `src/services/api/`       | Typed wrappers for REST endpoints + the SSE client                                                                                    |
| `tests/`                  | Mirrors `src/`                                                                                                                        |

## 3. Technology and versions

Vue 3.5, Vite 8, TypeScript 5.9, Pinia 4, vue-router 5, Tailwind 4, shadcn-vue 2.8 (reka-ui 2), @lucide/vue, vue-sonner, VueUse 15, zod 4, Firebase 12, `@guolao/vue-monaco-editor` 1.6 + `monaco-editor` 0.57, `eventsource-parser` 4, Vitest 5 + happy-dom + @vue/test-utils. Rationale and compatibility: [`research/05`](research/05-frontend-stack.md) §1.

## 4. Routing and guards

| Path                   | Name        | Layout           | Meta           | Component                                         |
| ---------------------- | ----------- | ---------------- | -------------- | ------------------------------------------------- |
| `/`                    | `root`      | —                | —              | redirect: signed in → `dashboard`, else `sign-in` |
| `/sign-in`             | `sign-in`   | Auth             | `guestOnly`    | `SignInPage`                                      |
| `/sign-up`             | `sign-up`   | Auth             | `guestOnly`    | `SignUpPage`                                      |
| `/dashboard`           | `dashboard` | App              | `requiresAuth` | `DashboardPage`                                   |
| `/projects/:projectId` | `workspace` | App (full-bleed) | `requiresAuth` | `WorkspacePage` (**lazy chunk**, includes Monaco) |
| `/:pathMatch(.*)*`     | `not-found` | App              | —              | `PageState` "Page not found" + link to dashboard  |

Guard: `await auth.authStateReady()`; `requiresAuth && !user` → `{ name: 'sign-in', query: { redirect: to.fullPath } }`; `guestOnly && user` → `dashboard`. `useAuth` also watches `onAuthStateChanged`: when the user becomes `null` while on a protected route → push `sign-in`. After sign-in, go to `redirect` if it is a safe internal path (starts with `/`, not `//`).

## 5. Data access layer

### 5.1 Firebase and environment

- `lib/env.ts` validates `import.meta.env` with zod (`VITE_FIREBASE_*`, `VITE_API_BASE_URL`, `VITE_GENERATE_BASE_URL`, `VITE_USE_EMULATORS`) and exports a typed `env`. Invalid env → a readable error screen instead of a blank page.
- `lib/firebase.ts` initializes the app once, exports `auth` and `db`, and connects the Auth (`http://127.0.0.1:9099`) and Firestore (`127.0.0.1:8080`) emulators when `VITE_USE_EMULATORS` is true.

### 5.2 HTTP client

`lib/http.ts` → `apiFetch<T>(target: 'api' | 'generate', path, { method, body, signal, timeoutMs = 20000 })`:

- Adds `Authorization: Bearer ${await auth.currentUser.getIdToken()}` (throws `UNAUTHENTICATED` when signed out), `Content-Type`/`Accept: application/json`, `X-Request-Id: crypto.randomUUID()`.
- Combines the caller's `signal` with `AbortSignal.timeout(timeoutMs)`.
- Success → returns `json.data`. Failure → throws `ApiError { status, code, message, retryable, details, requestId }` parsed from the envelope (falls back to `INTERNAL` / network errors → `NETWORK` pseudo-code with `retryable: true`).
- `lib/errors.ts` → `toUserMessage(error)` uses the contract catalog's default messages; never shows raw stacks.

### 5.3 Firestore repositories and listeners

- `services/firestore/paths.ts` builds typed refs (`projectDoc(uid, pid)`, `filesCol`, `messagesCol`, `generationsCol`, `snapshotsCol`, `blobDoc`, `integrationDoc`).
- `converters.ts` attaches `id` and types data as `ProjectDoc<Timestamp> & { id }` etc. from contracts.
- Repositories export query builders and the only client writes (`createProject`, `updateProject`, `softDeleteProject`) plus one-off reads (`getBlob`).
- `useFirestoreDoc(refGetter)` / `useFirestoreQuery(queryGetter)` return `{ data, loading, error }` (`shallowRef`), re-subscribe when the getter's result changes, and unsubscribe on scope dispose.

### 5.4 State ownership

| State                                                                                       | Owner                                             | Notes                                                           |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| Auth user                                                                                   | `useAuth` (module-level reactive)                 | From `onAuthStateChanged`                                       |
| Connection projection, projects, files, messages, generations, snapshots                    | Firestore listeners                               | Single source of truth                                          |
| Generation lifecycle (status, phase, prose, thinking, per-file status, error, partial)      | Pinia `generation` store                          | Pure reducer + actions                                          |
| Streamed file text                                                                          | Monaco models + a non-reactive `Map`              | Avoids reactivity storms                                        |
| Open tabs, active path, dirty paths, follow toggle, preview nonce, console open, mobile tab | Pinia `workspace` store                           | Reset per project                                               |
| Unsaved edits                                                                               | Monaco models (per path URI)                      | Outlive components; dirty = alternative version ≠ saved version |
| Panel sizes                                                                                 | `ResizablePanelGroup auto-save-id` (localStorage) | —                                                               |

## 6. Auth feature

- `useAuth()`: `{ user, ready, signIn(email, pw), signUp(email, pw), signOut() }`; persistence is Firebase's default `browserLocalPersistence` (survives refresh — R-AUTH2).
- `AuthForm.vue` (shared by both pages): shadcn `Card`, `Field`, `FieldLabel`, `Input`, `FieldError`, `Button` (spinner while submitting), `Alert` for server errors. Validation via `useZodForm`: email; password ≥ 8 chars; sign-up confirm must match.
- `auth-errors.ts`: `auth/email-already-in-use` → "An account with this email already exists."; `auth/invalid-credential` / `auth/wrong-password` / `auth/user-not-found` → "Email or password is incorrect."; `auth/weak-password` → "Choose a stronger password (at least 8 characters)."; `auth/invalid-email` → "Enter a valid email address."; `auth/too-many-requests` → "Too many attempts. Try again in a few minutes."; `auth/network-request-failed` → "Network error — check your connection."; default → "Something went wrong. Please try again."
- `UserMenu.vue`: `Avatar` initials + `DropdownMenu` (email, theme, Sign out).

## 7. HighLevel connection feature

- `useHighLevelConnection()` listens to `users/{uid}/integrations/highlevel` → `status: 'loading' | 'connected' | 'reauth_required' | 'disconnected'`, `locationName`, `locationId`, `timezone`, `scopes`; actions `connect()` (`POST /v1/hl/oauth/start` → `window.location.assign(authorizeUrl)`; button shows a spinner until navigation) and `disconnect()` (`DELETE /v1/hl/connection` after an `AlertDialog`).
- `ConnectionBadge.vue`: `Badge` — connected: "Connected · {locationName}" (tooltip: timezone + scopes); reauth: destructive "Reconnect HighLevel"; disconnected: outline "Not connected" (R-FE2 wording).
- `ConnectionCard.vue` (dashboard): title "HighLevel", status line, location name/timezone, primary action Connect / Reconnect, secondary Disconnect.
- `connection-query.ts`: on dashboard mount, read `?hl=` → `connected` → success toast "Connected to {name}"; `error` → error toast with a message per `reason` (`state_invalid`: "The connection link expired. Please try again."; `denied`: "Connection was cancelled."; `exchange_failed`: "HighLevel didn't accept the connection. Please try again."; `not_location_token`: "Please choose a sub-account (location), not an agency."; `internal`: generic) → `router.replace({ query: {} })`.

## 8. Projects dashboard

- `useProjects()` → query `where('status','==','active'), orderBy('updatedAt','desc'), limit(50)`; actions `create({ name, description })` (sets `locationId` from the connection projection or `null`), `rename`, `softDelete`.
- `DashboardPage.vue`: header row (title, "New project" button), `ConnectionCard`, project grid (`ProjectCard` × n), states: loading (3 skeleton cards), empty (`Empty` + CTA), error (`Alert` + Retry).
- `ProjectCard.vue`: `Card` with name, description (2-line clamp), "Updated {relative}", file count, location badge (warning badge "Different location" when `project.locationId` ≠ connected location), `DropdownMenu` (Open, Rename, Delete). Click → workspace.
- `ProjectFormDialog.vue`: `Dialog` for create and edit; fields name (1–60) and description (0–280, `Textarea`); submit disabled while invalid/submitting; after create → navigate to the workspace.
- `DeleteProjectDialog.vue`: `AlertDialog` "Delete {name}? It will be removed from your dashboard." (soft delete; rules reject while generating → toast).

## 9. Workspace layout

- `WorkspacePage.vue`: resolves `projectId`, subscribes to the project doc (not found / deleted → `PageState` with back link), provides project context to children (`provide(WorkspaceKey, …)`), resets the workspace and generation stores on project change, registers shortcuts.
- `WorkspaceHeader.vue`: back button, project name (click → rename dialog), `ConnectionBadge`, generation status pill (Planning…/Writing app.js…/Saving…/Done), "History" button (opens `SnapshotHistorySheet`), overflow menu.
- `WorkspaceLayout.vue`: ≥ 1024 px → `ResizablePanelGroup direction="horizontal" auto-save-id="genesis-workspace"` with `ChatPanel` (default 28 %, min 20), `CodePanel` (40 %, min 25), `PreviewPanel` (32 %, min 20) separated by `ResizableHandle with-handle`; < 1024 px → `Tabs` (Chat / Code / Preview).

## 10. Chat panel

| Component                     | Responsibility                                                                                                                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatPanel.vue`               | Composes list + live message + banner + composer; example prompts when the project has no files                                                                                                                                              |
| `MessageList.vue`             | `ScrollArea`; renders `MessageItem`s from the messages listener; sticks to bottom unless the user scrolled up ("Jump to latest" button)                                                                                                      |
| `MessageItem.vue`             | User bubble (right) / assistant (left, `whitespace-pre-wrap` plain text) / system note (centered, muted); assistant `meta` line: "Changed app.js, styles.css · Snapshot #4" or status note                                                   |
| `LiveAssistantMessage.vue`    | Visible only while a generation runs or just finished: phase label, `ThinkingDisclosure`, streaming prose with caret, `FileOpChips`                                                                                                          |
| `ThinkingDisclosure.vue`      | `Collapsible` "Planning…" with the summarized thinking text (collapsed by default, auto-collapses when writing starts)                                                                                                                       |
| `FileOpChips.vue`             | One chip per file: spinner (writing), check (valid), x + tooltip issues (rejected), trash (deleted); click opens the file                                                                                                                    |
| `GenerationOutcomeBanner.vue` | `Alert` for outcomes needing action: failed/interrupted with applyable partial → **Apply N files** / **Discard** / **Retry**; failed without partial → message + **Retry**; completed with rejected files → warning list                     |
| `PromptComposer.vue`          | `Textarea` (auto-grow 3–10 rows), counter `n/4000`, **Send** (Cmd/Ctrl+Enter); disabled when offline, generating, or empty; hint when HighLevel isn't connected: "You can generate now — connect HighLevel to see live data in the preview." |
| `ExamplePrompts.vue`          | 3 chips: "Contact dashboard with search and upcoming appointments", "Conversations inbox with a message thread", "This week's calendar appointments"                                                                                         |

Accessibility: an `aria-live="polite"` region announces phase changes and outcomes (not individual tokens).

## 11. Generation client

### 11.1 SSE client (`services/api/generation-stream.ts`)

```ts
export async function streamGeneration(opts: {
  projectId: string;
  clientRequestId: string;
  prompt: string;
  signal: AbortSignal;
  onEvent: (e: GenerationEvent) => void;
}): Promise<{ terminal: boolean }>;
```

`fetch(GEN + /v1/projects/{projectId}/generations, POST, Accept: text/event-stream, Authorization)` → non-2xx or non-SSE content type → throw `ApiError` (pre-stream errors). Else read `res.body.pipeThrough(new TextDecoderStream())` into `eventsource-parser`; each message → `JSON.parse` → `GenerationEventSchema.safeParse` (contracts) → valid → `onEvent`; unknown/invalid → ignored (logged once). A watchdog aborts after 45 s without bytes. Returns `{ terminal }` = whether a terminal event was seen.

### 11.2 Reducer and store

- `generation.reducer.ts`: `reduce(state, event): GenerationState` — pure; ignores events for other `generationId`s and out-of-order `seq` (≤ last seen).
- State: `{ status, generationId, clientRequestId, prompt, phase, prose, thinking, files: Record<path, { language, status: 'streaming'|'valid'|'rejected'|'deleted', bytes, issues }>, fileOrder, streamingPath, error, partial, result, lastSeq, lastEventAt, startedAt }`.
- Status machine: `idle → submitting → streaming → completed | failed | interrupted`; `streaming → reconciling → terminal` when the stream drops (`07` §5.2).
- `generation.store.ts` (Pinia setup store) owns the reducer state and actions:
  - `start(projectId, prompt)`: new `clientRequestId`; `submitting`; `streamGeneration(...)`; pre-stream `ApiError`: `GENERATION_IN_PROGRESS` → toast "Another tab is generating" and reconcile to that generation; `DUPLICATE_REQUEST` → reconcile; others → toast; back to `idle`. Stream ends without terminal → `reconcile(generationId)`.
  - `reconcile(generationId)`: listen to the generation document until a terminal status (or stale heartbeat ⇒ show interrupted), then set `error`/`partial`/`result` from the document.
  - `applyPartial()` → `POST …/apply` → toast "Applied N files (snapshot #k)" → `completed`. `discardPartial()` → `POST …/discard` → `idle`. `retry()` → `start(lastPrompt)`. `dismiss()` → `idle`.
  - An internal typed **event bus** emits editor events: `stream:file-start(path, language)`, `stream:file-delta(path, text)`, `stream:file-end(path, status)`, `stream:end(outcome)`.

### 11.3 Disconnection handling (R-FE6)

Detection: reader error, stream closed without a terminal event, or 45 s watchdog. UX: status pill "Reconnecting to generation…" → the generation document decides: `completed` → normal completion (listeners already updated files); `interrupted`/`failed` → banner with Apply/Discard/Retry per `partial`. Offline (`useOnline`) disables Send and shows a banner.

## 12. Code editor

- **Setup (`monaco-setup.ts`):** `import * as monaco from 'monaco-editor'`, `self.MonacoEnvironment.getWorker` using Vite `?worker` imports (editor, css, html, ts, json), `loader.config({ monaco })`, light/dark themes; imported only by the workspace chunk.
- **Models (`editor-models.ts`):** `EditorModels` class keyed by path; URI `file:///{projectId}/{path}`; tracks `baseVersion` (Firestore `version` the model was synced from) and `savedAltVersion` (Monaco alternative version at last sync/save) → `isDirty(path)`. Methods: `ensure(path, content, language)`, `syncFromRemote(file)` (updates the model only if not dirty; if dirty and the remote version is newer → flags a conflict), `beginStream(path, language)` (remember pre-stream content, clear model), `append(path, text)` (queued; flushed once per animation frame with `model.applyEdits([{ range: end, text }])`), `endStream(path, status)`, `revertStreamed()` (restore pre-stream content for anything not committed), `markSaved(path, version)`, `dispose(path)`, `disposeAll()`.
- **`CodePanel.vue`:** file tree (left, collapsible) + tabs + editor + status bar (language, bytes, version, dirty dot, "Read-only while generating").
- **`FileTree.vue`** built by `file-tree.ts` (pure: paths → nested nodes, folders first, `index.html` first): icons by extension, dirty dot, streaming spinner, rejected mark; click → open tab.
- **`EditorTabs.vue`:** shadcn `Tabs`; per-tab close button (dirty → `AlertDialog` "Discard unsaved changes?"); middle-click close.
- **`CodeEditor.vue`:** `<VueMonacoEditor :path :language :options @mount>`; options `readOnly` (true while generating), `automaticLayout`, `minimap: false`, `fontSize: 13`, `tabSize: 2`, `wordWrap: 'on'`, `scrollBeyondLastLine: false`; `Cmd/Ctrl+S` via `editor.addCommand`.
- **Streaming wiring:** the generation bus drives models; "Follow generation" (on by default) activates the streaming file's tab and reveals the last line; the user can switch tabs freely (other files remain inspectable).
- **After the stream:** completed → listeners deliver committed files → `syncFromRemote` (content equal to streamed text; versions update); failed/interrupted → `revertStreamed()`.
- **Save (`useFileSave`):** `PUT …/files/{fileId} { content, expectedVersion: baseVersion }` → success → `markSaved` + toast "Saved"; `FILE_VERSION_CONFLICT` → `SaveConflictDialog` (**Keep mine** → retry with `expectedVersion = currentVersion`; **Use theirs** → replace model with remote content); `GENERATION_IN_PROGRESS` → toast.

## 13. Live preview

### 13.1 Compiler (`compile-preview.ts`, pure)

`compilePreview({ files, runtimeSource, nonce }): { html: string; issues: PreviewIssue[] }`:

1. No `index.html` → issue `NO_ENTRY` (panel shows the empty state).
2. Parse `index.html` with `DOMParser` (inert — scripts don't execute).
3. `link[rel~="stylesheet"][href]`: local and present → replace with `<style data-genesis-href="…">` + content; missing → issue; remote → remove + issue.
4. `script[src]`: local and present → replace with an inline `<script data-genesis-src="…">` whose text is the file content with `</script` → `<\/script` and `<!--` → `<\!--`; remote → remove + issue. Inline `<script>` blocks are kept.
5. Remove `<base>` and `<meta http-equiv="refresh">`.
6. Prepend to `<head>`: `<meta charset="utf-8">` (if missing), the CSP meta (`preview-csp.ts`), and `<script>window.__GENESIS_NONCE__="{nonce}";{runtimeSource}</script>`.
7. Return `'<!DOCTYPE html>\n' + document.documentElement.outerHTML`.

### 13.2 Runtime (`runtime/genesis-runtime.js`, plain ES2020, imported `?raw`)

IIFE that: installs in-memory `localStorage`/`sessionStorage` shims; mirrors `console.*`, `window.onerror` and `unhandledrejection` to the host (queued until connected); creates `ready`; posts `hello` with the nonce to `window.parent`; on `init` (from `window.parent`, matching nonce) stores `context` and the port; implements `rpc(method, params)` (id counter, pending map, 20 s timeout → `PREVIEW_TIMEOUT`, rejects with `GenesisError`); builds `highlevel.*` wrappers for the seven read methods; defines `window.genesis` via `Object.defineProperty(window, 'genesis', { value: Object.freeze(api), writable: false, configurable: false })`.

### 13.3 Host bridge (`host-bridge.ts`)

`new PreviewHostBridge({ projectId, getContext, invoke, onLog, onCall })` → `attach(iframe, nonce)` / `detach()`:

- Listens to `window` `message`; accepts only `event.source === iframe.contentWindow`, `data.source === 'genesis-preview'`, `type === 'hello'`, matching nonce → creates a `MessageChannel`, posts `init` with `port2`, keeps `port1`.
- On `rpc`: method in `RUNTIME_METHODS` → else `UNKNOWN_METHOD`; `params` size ≤ 64 KB and schema-valid (contracts) → else `VALIDATION_FAILED`; budgets (≤ 6 in flight, ≤ 120/min) → else `PREVIEW_LIMIT`; call `invoke(method, params)` (→ `hl-runtime.api.ts`) with a 20 s timeout; reply `rpc-result`. `ApiError` → `{ code, message, retryable }`.
- On `console` / `runtime-error` → `onLog` (console drawer; error badge count).
- Each RPC → `onCall({ method, ms, ok, code })` for the "HighLevel calls" list.

### 13.4 Preview panel

- `PreviewPanel.vue`: compiles from **committed** Firestore files (never from dirty buffers); recompiles (new nonce, iframe `:key`) when the committed file set (`path` + `contentHash`) changes (debounced 150 ms) or on Reload; therefore it updates after generation commit, manual save and restore, and never during streaming (R-FE5).
- `PreviewFrame.vue`: `<iframe :srcdoc="html" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer" title="App preview">` — **never** `allow-same-origin`. `allow-forms` is required for `submit` events to fire; CSP `form-action 'none'` blocks real submissions. A second `load` event means the app navigated its frame away → the panel rebuilds the preview.
- `PreviewToolbar.vue`: status ("Live · snapshot #4" / "Waiting for first generation" / "Rebuilding…"), Reload, Console toggle with error-count `Badge`.
- `PreviewConsole.vue`: `ScrollArea` with two tabs (Console / HighLevel calls), clear button.
- Overlays: no files → `Empty` "Your app will appear here after the first generation"; HighLevel not connected → `Alert` with Connect button (calls will fail with `HL_NOT_CONNECTED` inside the app); compile issues → `Alert` listing them.

## 14. Snapshots

### 14.1 History sheet

`SnapshotHistorySheet.vue` (`Sheet side="right"`): `useSnapshots(projectId)` listens (while open) to the last 50 snapshots by `seq desc`. `SnapshotItem.vue`: `#seq` badge, kind badge (AI / Checkpoint / Restore), label (prompt excerpt or "Restored #n"), relative time with absolute `Tooltip`, "n files changed", "Current" badge for `latestSnapshotId` (plus "Unsaved edits since #n" when `workingTreeDirty`); action **Restore**. Snapshot diff (assignment bonus R-B3) is out of v1.

### 14.2 Restore

`RestoreSnapshotDialog.vue` (`AlertDialog`): "Restore snapshot #3? Your current files become a new version first if they have unsaved changes; nothing is lost." → `POST …/restore` → toast "Restored #3 (now #8)" → close sheet. Disabled while generating and for the current snapshot when the tree is clean.

## 15. UX states catalog

| Surface            | Loading                      | Empty                                        | Error                                    | Other                               |
| ------------------ | ---------------------------- | -------------------------------------------- | ---------------------------------------- | ----------------------------------- |
| Auth forms         | Button spinner               | —                                            | `Alert` with mapped message              | —                                   |
| Dashboard projects | 3 `Skeleton` cards           | `Empty` "No projects yet" + "Create project" | `Alert` "Couldn't load projects" + Retry | —                                   |
| Connection card    | `Skeleton` line              | "Not connected" + Connect                    | Toast on start failure                   | Reauth state, OAuth return toasts   |
| Workspace          | Full-panel `Spinner`         | —                                            | `PageState` "Project not found"          | Offline banner                      |
| Chat               | `Skeleton` bubbles           | Example prompts                              | Inline `Alert`                           | Live message, outcome banner        |
| File tree          | `Skeleton` rows              | "No files yet"                               | —                                        | Streaming/rejected marks            |
| Editor             | `Spinner` while Monaco loads | "Select a file"                              | `Alert` if Monaco fails                  | Read-only badge, conflict banner    |
| Preview            | "Rebuilding…" overlay        | `Empty`                                      | Compile issues `Alert`                   | Not-connected banner, console badge |
| Snapshot sheet     | `Skeleton` items             | "No versions yet — generate to create one"   | `Alert` + Retry                          | Current marker                      |

## 16. Accessibility and keyboard

- shadcn-vue/reka primitives supply focus traps, ARIA roles and keyboard support for dialogs, sheets, menus, tabs.
- Every input has a label; icon-only buttons have `aria-label` + `Tooltip`.
- Live region for generation phases/outcomes; reduced motion respected (`motion-safe:` utilities).
- Shortcuts: `Cmd/Ctrl+Enter` send; `Cmd/Ctrl+S` save; `Cmd/Ctrl+Shift+H` history sheet; `Esc` closes dialogs.
- Contrast via shadcn theme tokens (light and dark).

## 17. Performance

- Workspace route is lazy; Monaco (+ workers) only loads there.
- Streamed text: rAF-batched `applyEdits`; buffers outside reactivity; `LiveAssistantMessage` isolated so the message list doesn't re-render per token.
- `shallowRef` for listener arrays; message listener limited to 200; snapshot listener only while the sheet is open.
- Preview compile debounced; iframe re-created only when committed content changes.
- Bundle check in CI (`vite build` report); target main chunk < 300 KB gzip excluding Monaco.

## 18. Testing

| Target                                            | Tests                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `generation.reducer.ts`                           | Recorded fake-provider streams (happy path, rejected file, failure with partial); out-of-order/foreign events ignored                      |
| `generation-stream.ts`                            | Mock `fetch` with a `ReadableStream` split at random boundaries; pre-stream `ApiError`; missing terminal → `{ terminal: false }`; watchdog |
| `generation.store.ts`                             | Start/reconcile/apply/discard with mocked services                                                                                         |
| `compile-preview.ts`                              | Inlining, missing/remote refs, `</script` and `<!--` escaping, CSP + runtime first in `<head>`                                             |
| `genesis-runtime.js`                              | Evaluated in a happy-dom window with a fake parent: handshake, queued calls, rpc success/error/timeout, frozen global, storage shims       |
| `host-bridge.ts`                                  | Source/nonce checks, unknown method, schema rejection, budgets, timeout, result passthrough                                                |
| `file-tree.ts`, `auth-errors.ts`, `useZodForm.ts` | Pure unit tests                                                                                                                            |
| Components                                        | `PromptComposer` (disabled states, shortcut), `ConnectionBadge` (3 states), `GenerationOutcomeBanner` (actions), `SnapshotItem`            |

## 19. shadcn-vue inventory

`button input label textarea field card dialog alert-dialog sheet tabs badge dropdown-menu avatar separator scroll-area resizable tooltip sonner skeleton spinner empty alert collapsible select` — mapping to features in [`research/05`](research/05-frontend-stack.md) §2.
