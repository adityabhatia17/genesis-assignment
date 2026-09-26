# FE-8 — Polish, hardening and deploy

> Read [`00-overview.md`](00-overview.md) first. Spec: [`../06-frontend-system-design.md`](../06-frontend-system-design.md) §15–§18. Delivery: [`../10-delivery-git-and-deployment.md`](../10-delivery-git-and-deployment.md).

Order: **8.1 → 8.2 → 8.6 → 8.3 → 8.5 → 8.4**.

---

### Task FE-8.1: UX-state audit

Every surface already has its states (FSD §15). This task checks them against the design brief ([`../prompts/01-claude-design-genesis-ui.md`](../prompts/01-claude-design-genesis-ui.md)) with the emulators and the fake provider.

- [ ] **Step 1: Walk the catalog** and tick each row in a real browser, light and dark, 1440 px and 390 px:

| Surface | Loading | Empty | Error | Other |
|---|---|---|---|---|
| Auth | button spinner | — | mapped message | redirect after sign-in |
| Dashboard | 3 skeleton cards | "No projects yet" | "Couldn't load projects" + Retry | OAuth return toasts, reauth card |
| Workspace | "Opening project" | — | "Couldn't open this project" / "Project not found" | offline banner |
| Chat | skeleton messages | example prompts | outcome banner | live message, Stop |
| Files / editor | — | "No files yet" / "Select a file" | conflict notice + dialog | read-only while generating, Follow |
| Preview | "Rebuilding…" | "Your app will appear here" | build notes, console errors badge | not-connected and location-mismatch alerts |
| Snapshots | skeletons | "No snapshots yet" | "Couldn't load snapshots" + Retry | current marker, restore disabled while generating |
| Diff | spinner | "No changes in this version" | "Couldn't load the changes" | base switch |

- [ ] **Step 2: Global error handler** — already in `main.ts` (FE-0.6): unexpected component errors log once and show a generic toast.
- [ ] **Step 3: Copy review** — no emoji, no "AI magic" wording, sentences end without exclamation marks. **Commit** fixes as `fix(frontend): …`.

---

### Task FE-8.2: Accessibility and keyboard shortcuts

**Files:**
- Create: `frontend/src/features/workspace/composables/useWorkspaceShortcuts.ts`
- Modify: `frontend/src/features/workspace/WorkspacePage.vue` (call it — see FE-3.1)

`frontend/src/features/workspace/composables/useWorkspaceShortcuts.ts`:
```ts
import { useEventListener } from '@vueuse/core';
import { useWorkspaceStore } from '../stores/workspace.store';

/** Global workspace shortcuts. Cmd/Ctrl+Enter (send) lives in the composer, Cmd/Ctrl+S in Monaco. */
export function useWorkspaceShortcuts(): void {
  const workspace = useWorkspaceStore();
  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.shiftKey && event.key.toLowerCase() === 'h') {
      event.preventDefault();
      workspace.historyOpen = !workspace.historyOpen;
    }
  });
}
```

- [ ] **Step 1: Checks** — keyboard only: Tab through dashboard → workspace → composer; Cmd/Ctrl+Enter sends; Cmd/Ctrl+S saves; Cmd/Ctrl+Shift+H toggles snapshots; Esc closes dialogs/sheets; icon-only buttons have `aria-label`; the status pill is in an `aria-live="polite"` region; `prefers-reduced-motion` disables the caret pulse and chevron rotation (`motion-safe:` / `motion-reduce:`). Run the Lighthouse accessibility audit on `/dashboard` → ≥ 95.
- [ ] **Step 2: Commit** — `feat(frontend): add workspace keyboard shortcuts`

---

### Task FE-8.3: Performance budget

**Files:**
- Create: `frontend/scripts/check-bundle.mjs`

`frontend/scripts/check-bundle.mjs`:
```js
#!/usr/bin/env node
// Fails the build when the code needed for first paint grows past the budget.
// "First paint" = the entry chunk plus everything it imports statically (Monaco is lazy and excluded).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = Number(process.env.BUNDLE_BUDGET_KB ?? 350);
const dist = join(import.meta.dirname, '..', 'dist');
const manifest = JSON.parse(readFileSync(join(dist, '.vite', 'manifest.json'), 'utf8'));

const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry);
if (!entryKey) throw new Error('No entry chunk in dist/.vite/manifest.json (is build.manifest enabled?)');

const seen = new Set();
const visit = (key) => {
  if (seen.has(key)) return;
  seen.add(key);
  for (const dep of manifest[key].imports ?? []) visit(dep);
};
visit(entryKey);

let total = 0;
for (const key of seen) {
  const file = manifest[key].file;
  const kb = gzipSync(readFileSync(join(dist, file))).length / 1024;
  total += kb;
  console.log(`${kb.toFixed(1).padStart(8)} KB  ${file}`);
}
console.log(`${total.toFixed(1).padStart(8)} KB  total (gzip) — budget ${BUDGET_KB} KB`);
if (total > BUDGET_KB) {
  console.error('Initial bundle is over budget. Lazy-load the new dependency or raise the budget deliberately.');
  process.exit(1);
}
```

- [ ] **Step 1: Run** `npm run build && npm run check:bundle`. Measured when this plan was verified: ≈ 300 KB gzip for first paint (entry + Firebase Auth/Firestore + zod + reka/lucide); Monaco (~1.1 MB gzip with workers) is only in the lazy workspace chunk. CI runs this after the build (10-delivery §4.1).
- [ ] **Step 2 (optional, if time):** load only the Monaco languages Genesis edits — replace `import * as monaco from 'monaco-editor'` in `monaco-setup.ts` with `import * as monaco from 'monaco-editor/editor'` plus `import 'monaco-editor/features/register.all'`, `import 'monaco-editor/languages/definitions/{html,css,javascript}/register'` and `import 'monaco-editor/languages/features/{html,css,typescript}/register'` (entry points added in monaco-editor 0.56). Re-run the build and compare the workspace chunk.
- [ ] **Step 3: Commit** — `chore(frontend): enforce initial bundle budget`

---

### Task FE-8.4 (optional): End-to-end smoke test with Playwright

Out of v1. Production smoke is the manual checklist in FE-8.6.

### Task FE-8.5 (bonus R-B6): Webhook events in the preview

Assignment bonus R-B6 is **out of v1**. Do not add `events.repo.ts`, `usePreviewEvents`, or `bridge.pushEvent`.

### Task FE-8.6: Deploy to Firebase Hosting and smoke-test production (R-DEP1)

- [ ] **Step 1: Production env** — `frontend/.env.production` has the real Firebase web config and the deployed function URLs (FE-0.4). `ALLOWED_ORIGINS` in `functions/.env.<projectId>` contains `https://<projectId>.web.app` and `https://<projectId>.firebaseapp.com`; `APP_BASE_URL` is the Hosting URL (OAuth returns there).
- [ ] **Step 2: Build and deploy** (from the repo root)

```bash
npm --prefix frontend run lint && npm --prefix frontend run typecheck && npm --prefix frontend test
npm --prefix frontend run build && npm --prefix frontend run check:bundle
firebase deploy --only hosting
```

Expected: `Hosting URL: https://<projectId>.web.app`.

- [ ] **Step 3: Production smoke** — run the BE-8.6 checklist plus:

| # | Check | Expected |
|---|---|---|
| 1 | Open `/projects/anything` signed out | redirected to `/sign-in?redirect=…` |
| 2 | Refresh on `/dashboard` while signed in | stays signed in (R-AUTH2) |
| 3 | Deep link reload on `/projects/<id>` | SPA rewrite serves the app |
| 4 | Response headers of `/` | `X-Frame-Options: DENY`, `nosniff`, HSTS; **no** CSP header (preview inheritance) |
| 5 | Network tab during a generation | `text/event-stream` from `…cloudfunctions.net/generate`, events arriving incrementally |
| 6 | Preview iframe attributes | `sandbox="allow-scripts allow-forms"`, no `allow-same-origin` |
| 7 | Narrow window (390 px) | Chat / Code / Preview tabs; a stream keeps running when switching tabs |

- [ ] **Step 4: Commit and tag** — `git tag -a v1.0.0 -m "Genesis submission" && git push --tags` (after BE-8.6).
