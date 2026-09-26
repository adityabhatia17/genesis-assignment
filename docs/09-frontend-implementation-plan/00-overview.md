# Genesis Frontend — Implementation Plan (overview)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Give each worker: this overview's **Global Constraints** + **Coding Standards** + the single task it owns.

**Goal:** Build the Genesis single-page app — Firebase email/password auth, HighLevel connection, project dashboard, and the three-panel workspace (chat with live SSE generation, Monaco editor with streaming and manual save, sandboxed live preview wired to real HighLevel data through a host bridge, snapshot history with restore) — deployed to Firebase Hosting.

**Architecture:** Vue 3 SPA in feature slices. Firestore listeners are the single source of truth for durable data; Pinia holds only ephemeral UI and generation state; Monaco models hold unsaved text. All server calls go through one typed HTTP client (`lib/http.ts`) and one SSE client; contracts (`src/contracts/`) are generated from `functions/src/contracts`. The preview is a `srcdoc` iframe (`sandbox="allow-scripts allow-forms"`, network-blocking CSP) that receives capabilities, never credentials, over a `MessageChannel`.

**Tech stack:** Node 24 · Vue 3.5 · Vite 8 · TypeScript 5.9 · vue-tsc 3 · Pinia 4 · vue-router 5 · Tailwind CSS 4 · shadcn-vue 2.8 (reka-ui 2) · @lucide/vue · vue-sonner 2 · VueUse 15 · zod 4 · Firebase JS SDK 12 · `@guolao/vue-monaco-editor` 1.6 + `monaco-editor` 0.57 · `eventsource-parser` 4 · Vitest 5 + happy-dom 20 + @vue/test-utils 2.5 · ESLint 10 + typescript-eslint 8 + eslint-plugin-vue 10 · Prettier 3.

**Spec:** [`../06-frontend-system-design.md`](../06-frontend-system-design.md) (how) and [`../07-end-to-end-system-design.md`](../07-end-to-end-system-design.md) §3 (canonical contracts: REST, SSE, bridge, runtime SDK, Firestore schema, errors). UI brief: [`../prompts/01-claude-design-genesis-ui.md`](../prompts/01-claude-design-genesis-ui.md). Background: [`../research/05-frontend-stack.md`](../research/05-frontend-stack.md). Backend counterpart: [`../08-backend-implementation-plan/`](../08-backend-implementation-plan/00-overview.md).

---

## Global Constraints

- Node **24** (`.nvmrc`), npm; the frontend is its own npm project in `frontend/` (no workspaces).
- TypeScript **5.9.x** (not 7.x — typescript-eslint's peer range stops below 6.1). `strict`, `noUncheckedIndexedAccess`; `verbatimModuleSyntax` (from `@vue/tsconfig`): type-only imports use `import type`.
- `<script setup lang="ts">` everywhere; typed `defineProps<…>()` / `defineEmits<…>()`; **no `any`**.
- **shadcn-vue is the only component library** (R-FE1). Every button, input, dialog, sheet, tab, badge, menu, tooltip, toast, skeleton, alert and layout primitive comes from `src/components/ui/*`. Monaco and the preview iframe are the only non-shadcn surfaces. Icons: `@lucide/vue` only (what shadcn-vue 2.8 installs).
- `src/contracts/` is **generated** (`npm run contracts:sync` at the repo root). Never edit it by hand; CI fails on drift.
- Server calls only through `lib/http.ts` (`apiFetch`) and `services/api/generation-stream.ts`. Components never call `fetch`, `onSnapshot` or Firestore write APIs directly — they use composables and `services/*`.
- Client Firestore writes are **only** project create / rename / soft-delete, exactly as the rules in BE-2.1 accept them (`serverTimestamp()` for `createdAt`/`updatedAt`/`deletedAt`).
- Base URLs come from env: `VITE_API_BASE_URL` (…/api) and `VITE_GENERATE_BASE_URL` (…/generate). SSE goes **directly to the `generate` function URL**, never through Hosting rewrites.
- Preview iframe: `srcdoc`, `sandbox="allow-scripts allow-forms"` — **never** `allow-same-origin`, `allow-popups`, `allow-top-navigation` or `allow-modals`. The compiled document starts with the CSP meta (`connect-src 'none'`, `form-action 'none'`, …) and then the runtime. The iframe never receives a Firebase ID token or any HighLevel credential.
- Limits come from `contracts/limits.ts` (`LIMITS.promptMaxChars` = 4000, `LIMITS.sseWatchdogMs` = 45 000, bridge budgets, …). Never hard-code a limit that exists there.
- Error codes, HTTP statuses and default messages come from `contracts/errors.ts` (`07` §3.6). User-visible error text goes through `lib/errors.ts` `toUserMessage()`; never show stacks or raw bodies.
- UI copy is factual and calm ("Writing app.js", "Saved", "Snapshot #4"). No emoji, no "magic"/sparkle language, no gradients (design brief).
- Never log tokens, prompts in full, file contents or HighLevel records to the console in production code.

## Coding Standards

| Rule          | Detail                                                                                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layering      | `components (*.vue)` render → `composables` orchestrate → `services/*` talk to Firestore/HTTP → `contracts`/`lib`. Pure logic (reducers, compilers, tree builders, error mapping) lives in `.ts` files with no Vue imports and is unit-tested |
| State         | Firestore listeners for durable data (`useFirestoreDoc`/`useFirestoreQuery`, `shallowRef`). Pinia setup stores for ephemeral cross-component state. Local `ref` for component-only state. Big streamed text never enters deep reactivity      |
| Components    | PascalCase file names, one component per file, ≲ 200 lines; props down / events up; `v-model` via `defineModel` where it fits; no business logic in templates beyond simple conditionals                                                      |
| TS modules    | kebab-case file names; named exports only; ≲ 300 lines; functions ≲ 50 lines where practical                                                                                                                                                  |
| Composables   | `useX` naming; return plain objects of refs/functions; clean up with `onScopeDispose`/`onBeforeUnmount`                                                                                                                                       |
| Errors        | Catch at the edge (composable/store action), map with `toUserMessage`, show a toast or inline `Alert`. Never swallow silently; unexpected errors go to `console.error` once                                                                   |
| Async         | No floating promises (`@typescript-eslint/no-floating-promises`); use `void promise.catch(handler)` when fire-and-forget is intended                                                                                                          |
| Accessibility | Every input has a label; icon-only buttons have `aria-label` + `Tooltip`; dialogs/sheets from reka primitives; visible focus; `aria-live` for generation status                                                                               |
| Styling       | Tailwind utilities + shadcn theme tokens (`bg-background`, `text-muted-foreground`, `border`…); no hard-coded hex colors in components; `cn()` for conditional classes; `motion-safe:` for animation                                          |
| Tests         | Vitest in `tests/**` mirroring `src/**` (`*.test.ts`); pure modules 100 % of branches that matter; components tested through behavior (rendered text, emitted events), not snapshots                                                          |
| Comments      | Explain _why_; no commented-out code; no TODOs in merged code                                                                                                                                                                                 |

## File map (frontend)

```
frontend/
├── package.json · package-lock.json · index.html · components.json · eslint.config.js · .prettierignore   (FE-0.1–0.3)
├── vite.config.ts · vitest.config.ts · tsconfig.json · tsconfig.app.json · tsconfig.node.json · tsconfig.vitest.json   (FE-0.1, 0.3)
├── .env.example · .env.production (public values, committed) · .env.local (emulators, git-ignored)   (FE-0.4)
├── public/favicon.svg                                                               (FE-0.1)
├── scripts/check-bundle.mjs                                                         (FE-8.3)
├── src/
│   ├── main.ts · env.d.ts                                                           (FE-0.1, 0.6, 1.1)
│   ├── assets/main.css                                                              (FE-0.2)
│   ├── contracts/*                          GENERATED by `npm run contracts:sync`    (FE-0.1)
│   ├── app/App.vue · router.ts · guards.ts · config-error.ts · NotFoundPage.vue · layouts/AuthLayout.vue · layouts/AppLayout.vue   (FE-0.4, 0.6)
│   ├── components/ui/**                     shadcn-vue generated                     (FE-0.2)
│   ├── components/common/PageState.vue · RelativeTime.vue · OfflineBanner.vue · ThemeToggle.vue · ConfirmDialog.vue   (FE-0.6)
│   ├── components/common/UserMenu.vue (FE-1.4) · AppHeader.vue (FE-2.2)
│   ├── composables/useTheme.ts · useConfirm.ts (FE-0.6) · useAuth.ts (FE-1.1) · useZodForm.ts (FE-1.2)
│   ├── composables/firestore-errors.ts · useFirestoreDoc.ts · useFirestoreQuery.ts (FE-2.1)
│   ├── lib/utils.ts (CLI) · time.ts (FE-0.3) · env.ts · firebase.ts (FE-0.4) · http.ts · errors.ts · ids.ts (FE-0.5)
│   ├── services/firestore/types.ts · converters.ts · paths.ts (FE-2.1) · projects.repo.ts (FE-2.3) · files.repo.ts (FE-3.1)
│   │                      messages.repo.ts (FE-3.2) · generations.repo.ts (FE-4.3) · snapshots.repo.ts (FE-7.1)
│   ├── services/api/hl-oauth.api.ts (FE-2.2) · generation-stream.ts (FE-4.1) · generations.api.ts (FE-4.3)
│   │                files.api.ts (FE-5.6) · hl-runtime.api.ts (FE-6.3) · snapshots.api.ts (FE-7.2)
│   └── features/
│       ├── auth/auth.schemas.ts · auth-errors.ts · redirect.ts (FE-1.2) · AuthForm.vue · SignInPage.vue · SignUpPage.vue (FE-1.3)
│       ├── highlevel/useHighLevelConnection.ts · connection-query.ts · useOAuthReturnToast.ts · ConnectionBadge.vue · ConnectionCard.vue (FE-2.2)
│       ├── projects/project-form.schema.ts · useProjects.ts (FE-2.3) · DashboardPage.vue · ProjectCard.vue · ProjectFormDialog.vue · DeleteProjectDialog.vue (FE-2.4)
│       ├── workspace/
│       │   ├── workspace-context.ts · WorkspacePage.vue · WorkspaceHeader.vue · WorkspaceLayout.vue (FE-3.1)
│       │   ├── stores/workspace.store.ts (FE-3.1) · generation.reducer.ts · generation.labels.ts (FE-4.2) · generation-bus.ts · generation.store.ts (FE-4.3)
│       │   ├── chat/message-meta.ts · MessageItem.vue · MessageList.vue (FE-3.2) · PromptComposer.vue · ExamplePrompts.vue · ChatPanel.vue (FE-3.3)
│       │   ├── chat/LiveAssistantMessage.vue · ThinkingDisclosure.vue · FileOpChips.vue · GenerationStatusPill.vue (FE-4.3) · GenerationOutcomeBanner.vue (FE-4.5)
│       │   ├── editor/monaco-setup.ts (FE-5.1) · editor-models.ts (FE-5.2) · file-tree.ts · FileTree.vue · FileTreeNode.vue (FE-5.3)
│       │   ├── editor/EditorTabs.vue · CodeEditor.vue · EditorStatusBar.vue · CodePanel.vue (FE-5.4) · SaveConflictDialog.vue (FE-5.6)
│       │   ├── preview/preview-csp.ts · preview-refs.ts · compile-preview.ts (FE-6.1) · runtime/genesis-runtime.js (FE-6.2) · host-bridge.ts (FE-6.3)
│       │   ├── preview/PreviewFrame.vue · PreviewToolbar.vue · PreviewConsole.vue · PreviewPanel.vue (FE-6.4)
│       │   └── composables/useProjectFiles.ts (FE-3.1) · useProjectMessages.ts (FE-3.2) · useGeneration.ts (FE-4.6) · useStreamingEditor.ts · useRemoteFileSync.ts (FE-5.5)
│       │                   useFileSave.ts (FE-5.6) · useWorkspaceShortcuts.ts (FE-8.2)
│       └── snapshots/useSnapshots.ts · SnapshotItem.vue · SnapshotHistorySheet.vue (FE-7.1) · RestoreSnapshotDialog.vue (FE-7.2)
└── tests/  setup.ts · helpers/fake-monaco.ts · fixtures/sse.ts · lib/ · app/ · composables/ · features/** · services/**   (25 files, 90 tests)
```

Full repository tree (backend included): [`../04-high-level-design.md`](../04-high-level-design.md) §10.

## Verification of this plan

All frontend code in FE-0 … FE-8 was assembled into a scratch project with the exact dependency versions above, the shadcn-vue 2.8.2 CLI output and the backend contract files taken verbatim from BE-0.3/BE-1, then checked with `vue-tsc --build` (0 errors), `eslint .` (0 problems, type-aware rules), `vitest run` (25 files, 90 tests passing), `vite build` (success; ~300 KB gzip first-paint, Monaco lazy) and a browser smoke of the auth pages, guards and 404. Findings that changed the design along the way are recorded in the tasks (e.g. `allow-forms`, monaco-editor 0.56+ worker paths, `@lucide/vue`, the root `tsconfig.json` paths shadcn-vue needs, the Monaco wrapper disposing attached models, Vitest's `beforeEach` return-value cleanup).

## Phases and tasks

| Phase                      | File                                                                                   | Tasks                                                                                                                                                                             | Day | Depends on       |
| -------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------- |
| FE-0 Foundation            | [`01-foundation.md`](01-foundation.md)                                                 | 0.1 scaffold · 0.2 Tailwind v4 + shadcn-vue · 0.3 lint, format, test tooling · 0.4 env + Firebase + emulators · 0.5 HTTP client + errors · 0.6 router, guards, layouts, app shell | 1   | BE-0.1, BE-1.6   |
| FE-1 Auth                  | [`02-auth.md`](02-auth.md)                                                             | 1.1 `useAuth` · 1.2 `useZodForm` + schemas + error mapping · 1.3 auth pages · 1.4 user menu + sign-out + session check                                                            | 1   | FE-0             |
| FE-2 Dashboard & HighLevel | [`03-dashboard-and-highlevel-connection.md`](03-dashboard-and-highlevel-connection.md) | 2.1 Firestore data layer · 2.2 HighLevel connection · 2.3 projects repository · 2.4 dashboard page + dialogs                                                                      | 2   | FE-1, BE-2, BE-3 |
| FE-3 Workspace & chat      | [`04-workspace-shell-and-chat.md`](04-workspace-shell-and-chat.md)                     | 3.1 workspace shell + store · 3.2 message list · 3.3 composer + example prompts                                                                                                   | 3   | FE-2             |
| FE-4 Generation client     | [`05-generation-streaming-client.md`](05-generation-streaming-client.md)               | 4.1 SSE client · 4.2 reducer · 4.3 store + live message · 4.5 reconcile + outcome banner · 4.6 disconnects, attach, leave guard                                                   | 3   | FE-3, BE-6       |
| FE-5 Code editor           | [`06-code-editor.md`](06-code-editor.md)                                               | 5.1 Monaco setup · 5.2 editor models · 5.3 file tree · 5.4 panel, tabs, editor · 5.5 streaming + remote sync · 5.6 save + conflicts                                               | 4   | FE-4, BE-7.1     |
| FE-6 Preview               | [`07-live-preview-and-runtime.md`](07-live-preview-and-runtime.md)                     | 6.1 compiler + CSP · 6.2 runtime SDK · 6.3 host bridge + runtime API · 6.4 preview panel                                                                                          | 4   | FE-3, BE-4       |
| FE-7 Snapshots             | [`08-snapshots-and-diff.md`](08-snapshots-and-diff.md)                                 | 7.1 history sheet · 7.2 restore                                                                                                                                                   | 4–5 | FE-5, BE-7.2     |
| FE-8 Polish & deploy       | [`09-polish-hardening-and-bonuses.md`](09-polish-hardening-and-bonuses.md)             | 8.1 UX-state audit · 8.2 a11y + shortcuts · 8.3 performance budget · 8.6 Hosting deploy + smoke                                                                                   | 5   | all              |

## Command cheat sheet (run from `frontend/` unless noted)

```bash
npm ci                                   # install
npm run dev                              # Vite dev server on http://localhost:5173
npm run lint                             # eslint (Vue + TS, type-aware)
npm run typecheck                        # vue-tsc --build
npm test                                 # vitest run (unit + component)
npm run build                            # typecheck + vite build → dist/
npm run preview                          # serve dist/ locally
npm run contracts:sync                   # from repo root: regenerate src/contracts
npm run emulators                        # from repo root: auth, firestore, functions (+ UI on :4000)
firebase deploy --only hosting           # from repo root (runs the frontend build via predeploy)
```

## Commits and branches

- Branch per phase (`feat/fe-0-foundation`, `feat/fe-4-generation-client`, …) or trunk-based on `main` while solo with green CI — see [`../10-delivery-git-and-deployment.md`](../10-delivery-git-and-deployment.md) §3.
- Conventional Commits scoped `frontend`: `feat(frontend): …`, `test(frontend): …`, `chore(frontend): …`, `fix(frontend): …`.
- Each task ends with a commit. Never commit `.env.local` or anything with a real secret. `frontend/.env.production` holds **public** values only (Firebase web config and function URLs) and is committed on purpose.

## Definition of done (frontend)

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` are clean; `npm run contracts:check` (root) is clean.
- Sign up / sign in / refresh keeps the session / sign out works; errors show mapped messages.
- Dashboard: connect HighLevel (location name shown), disconnect, OAuth return toasts; create / rename / delete projects with loading, empty and error states.
- Workspace: chat history; live generation (phase, planning text, streaming prose, per-file chips); tokens stream into Monaco read-only; interrupted/failed outcomes with Apply / Discard / Retry; reconnect after refresh.
- Editor: file tree, tabs, manual save with version conflicts handled; unsaved edits survive tab switches.
- Preview: renders committed files in the sandbox, shows real sandbox HighLevel data, updates after generation/save/restore, console + HighLevel-calls drawer, never receives credentials.
- Snapshot sheet with timestamps; restore.
- Deployed on Firebase Hosting; production smoke checklist (FE-8.6 + BE-8.6) passes.
