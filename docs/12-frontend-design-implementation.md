# Genesis — Frontend design implementation

**Status:** Approved
**Date:** 2026-09-26
**Reads:** [`11-design-system.md`](11-design-system.md) (the tokens and rules), [`06-frontend-system-design.md`](06-frontend-system-design.md) (architecture), [`09-frontend-implementation-plan/`](09-frontend-implementation-plan/00-overview.md) (task-by-task build, code-verified).
**Purpose:** the one place that says _how the design system in `11` becomes the running app_ — which layer owns which value, the exact file edits, and which frontend-plan tasks change as a result. Nothing here duplicates `11`'s values; it references them by token name.

---

## 1. Build layers

Five layers, each owning one thing, each reading only from the layer below:

```
1. Design tokens (11-design-system.md §2-4)
       │  color hex/oklch, type scale, radius, shadow
       ▼
2. Tailwind theme (src/assets/main.css — @theme block)
       │  --background, --primary, --text-md, --radius-lg, …
       ▼
3. shadcn-vue components (src/components/ui/**, CLI-generated)
       │  Button, Input, Dialog, Tabs, … — read theme vars only, never hex
       ▼
4. Genesis components (src/components/common/**, feature-local)
       │  StatusDot, StatusBadge, PanelHeader, EmptyState, …
       ▼
5. Screens (src/features/**/*.vue)
          Dashboard, Workspace, Auth — compose layer 4 + 3
```

A value never skips a layer: a screen must not hard-code `#2e64a6`, and layer 4 components must not hard-code a hex either — both read Tailwind utility classes (`bg-primary`, `text-faint-foreground`) that resolve through layer 2. This is already frontend-plan rule R-FE1 / `00-overview.md` "Styling" row; this document is what fills that rule in with real values.

## 2. Fonts — replace Inter with Geist

FE-0.2 ([`09-frontend-implementation-plan/01-foundation.md`](09-frontend-implementation-plan/01-foundation.md) step 4) currently self-hosts Inter via `@fontsource-variable/inter`. Swap for Geist:

```bash
cd frontend
npm uninstall @fontsource-variable/inter
npm install @fontsource-variable/geist@^5.3.0 @fontsource-variable/geist-mono@^5.3.0
```

Both packages are published under the OFL-1.1 license (verified on the npm registry, 2026-09-26; ~29 KB and ~23 KB woff2 respectively for the Latin subset — comparable to Inter's existing footprint, no bundle-budget impact on the 350 KB gzip first-paint budget in [`09-frontend-implementation-plan/09-polish-hardening-and-bonuses.md`](09-frontend-implementation-plan/09-polish-hardening-and-bonuses.md)).

This also fixes an existing bug in FE-0.2: its step 4 instructs removing the CLI's Google Fonts `@import` "no third-party request at runtime," but the `main.css` block it then specifies still opens with `@import url('https://fonts.googleapis.com/css2?family=Inter…')`. The corrected file below has no remote `@import` at all.

## 3. `frontend/src/assets/main.css` — full replacement

Replaces FE-0.2 step 4's file in [`09-frontend-implementation-plan/01-foundation.md`](09-frontend-implementation-plan/01-foundation.md) (lines ~311-444). Verified against a scratch Tailwind 4.3.3 + `@tailwindcss/vite` build — every class below compiles to the expected CSS.

```css
@import 'tailwindcss';
@import 'tw-animate-css';
@import '@fontsource-variable/geist';
@import '@fontsource-variable/geist-mono';

@custom-variant dark (&:is(.dark *));

@theme {
  /* Design system §3 — Geist's 11/12/13/14/15/18/20/22px scale.
     text-sm (13px) is the workspace default; text-base (14px) is auth/dashboard body. */
  --text-2xs: 0.6875rem;   /* 11px — version tags, shortcut keys */
  --text-2xs--line-height: 1rem;
  --text-xs: 0.75rem;      /* 12px — captions, mono file paths */
  --text-xs--line-height: 1.4;
  --text-sm: 0.8125rem;    /* 13px — workspace body */
  --text-sm--line-height: 1.45;
  --text-base: 0.875rem;   /* 14px — auth/dashboard body */
  --text-base--line-height: 1.45;
  --text-md: 0.9375rem;    /* 15px — dialog/sheet titles */
  --text-md--line-height: 1.3;
  --text-lg: 1.125rem;     /* 18px — page-state titles */
  --text-lg--line-height: 1.25;
  --text-xl: 1.25rem;      /* 20px — auth title */
  --text-xl--line-height: 1.2;
  --text-2xl: 1.375rem;    /* 22px — page title */
  --text-2xl--line-height: 1.2;
  --text-2xl--letter-spacing: -0.015em;
}

@theme inline {
  --font-sans: 'Geist Variable', ui-sans-serif, system-ui, sans-serif;
  --font-heading: var(--font-sans);
  --font-mono: 'Geist Mono Variable', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --color-sidebar-ring: var(--sidebar-ring);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar: var(--sidebar);
  --color-chart-5: var(--chart-5);
  --color-chart-4: var(--chart-4);
  --color-chart-3: var(--chart-3);
  --color-chart-2: var(--chart-2);
  --color-chart-1: var(--chart-1);
  --color-ring: var(--ring);
  --color-input: var(--input);
  --color-border: var(--border);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent: var(--accent);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted: var(--muted);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary: var(--secondary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary: var(--primary);
  --color-primary-hover: var(--primary-hover);
  --color-primary-soft: var(--primary-soft);
  --color-popover-foreground: var(--popover-foreground);
  --color-popover: var(--popover);
  --color-card-foreground: var(--card-foreground);
  --color-card: var(--card);
  --color-foreground: var(--foreground);
  --color-background: var(--background);
  --color-success: var(--success);
  --color-success-soft: var(--success-soft);
  --color-warning: var(--warning);
  --color-warning-soft: var(--warning-soft);
  --color-destructive-soft: var(--destructive-soft);
  --color-faint-foreground: var(--faint-foreground);
  --color-code: var(--code);
  --color-syntax-keyword: var(--syntax-keyword);
  --color-syntax-string: var(--syntax-string);
  --color-syntax-number: var(--syntax-number);
  --color-syntax-property: var(--syntax-property);
  --color-scrim: var(--scrim);
  --radius-sm: calc(var(--radius) - 6px);   /* 4px — badges */
  --radius-md: calc(var(--radius) - 4px);   /* 6px — buttons, inputs */
  --radius-lg: var(--radius);               /* 8px — cards, menus, toasts */
  --radius-xl: calc(var(--radius) + 2px);   /* 10px — dialogs, sheets */
  --shadow-elevation: var(--elevation);
}

:root {
  --radius: 0.5rem; /* 8px base; see radius-* mapping above for the 4/6/8/10px scale */

  /* Design system §2.1 (light) */
  --background: #f7f7f6;
  --foreground: #1a1a19;
  --card: #ffffff;
  --card-foreground: #1a1a19;
  --popover: #ffffff;
  --popover-foreground: #1a1a19;
  --primary: oklch(0.5 0.12 255);
  --primary-hover: oklch(0.45 0.12 255);
  --primary-foreground: #ffffff;
  --primary-soft: oklch(0.95 0.025 255);
  --secondary: #f2f2f0;
  --secondary-foreground: #1a1a19;
  --muted: #f2f2f0;
  --muted-foreground: #57564f;
  --faint-foreground: #6f6e68;
  --accent: #ececea;
  --accent-foreground: #1a1a19;
  --destructive: oklch(0.52 0.14 27);
  --destructive-foreground: #ffffff;
  --destructive-soft: oklch(0.96 0.02 27);
  --border: #e6e5e2;
  --input: #d6d5d1;
  /* Opaque form of the design's semi-transparent ring token — see 11-design-system.md §8
     finding 2: shadcn's own ring-*/50 utilities already apply alpha, so storing an
     alpha token here would double-compound it to near invisibility. */
  --ring: oklch(0.62 0.13 255);
  --success: oklch(0.5 0.09 150);
  --success-soft: oklch(0.95 0.03 150);
  --warning: oklch(0.52 0.1 70);
  --warning-soft: oklch(0.96 0.035 85);
  --code: #fcfcfb;
  --syntax-keyword: oklch(0.48 0.13 255);
  --syntax-string: oklch(0.48 0.09 150);
  --syntax-number: oklch(0.52 0.1 55);
  --syntax-property: oklch(0.47 0.08 200);
  --scrim: rgb(20 20 18 / 0.28);
  --elevation: 0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px rgb(0 0 0 / 0.08);
  --chart-1: oklch(0.646 0.222 41.116);
  --chart-2: oklch(0.6 0.118 184.704);
  --chart-3: oklch(0.398 0.07 227.392);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);
  --sidebar: #ffffff;
  --sidebar-foreground: #1a1a19;
  --sidebar-primary: oklch(0.5 0.12 255);
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: #ececea;
  --sidebar-accent-foreground: #1a1a19;
  --sidebar-border: #e6e5e2;
  --sidebar-ring: oklch(0.62 0.13 255);
}

.dark {
  /* Design system §2.2 (dark) */
  --background: #0f0f0e;
  --foreground: #ececea;
  --card: #151514;
  --card-foreground: #ececea;
  --popover: #151514;
  --popover-foreground: #ececea;
  --primary: oklch(0.72 0.1 255);
  --primary-hover: oklch(0.78 0.09 255);
  --primary-foreground: #0e1014;
  --primary-soft: oklch(0.3 0.04 255);
  --secondary: #1b1b1a;
  --secondary-foreground: #ececea;
  --muted: #1b1b1a;
  --muted-foreground: #a6a59f;
  --faint-foreground: #85847d;
  --accent: #222220;
  --accent-foreground: #ececea;
  /* Destructive label: 11-design-system.md §8 finding 1 — white-on-err fails AA in dark
     mode (2.61:1). Use the theme background as the label color instead (7.35:1). */
  --destructive: oklch(0.72 0.12 27);
  --destructive-foreground: #0f0f0e;
  --destructive-soft: oklch(0.29 0.05 27);
  --border: #262624;
  --input: #34332f;
  --ring: oklch(0.72 0.1 255);
  --success: oklch(0.74 0.09 150);
  --success-soft: oklch(0.28 0.035 150);
  --warning: oklch(0.78 0.1 80);
  --warning-soft: oklch(0.29 0.04 80);
  --code: #121211;
  --syntax-keyword: oklch(0.76 0.1 255);
  --syntax-string: oklch(0.76 0.09 150);
  --syntax-number: oklch(0.8 0.09 70);
  --syntax-property: oklch(0.78 0.08 200);
  --scrim: rgb(0 0 0 / 0.55);
  --elevation: 0 1px 2px rgb(0 0 0 / 0.4), 0 12px 32px rgb(0 0 0 / 0.5);
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: #151514;
  --sidebar-foreground: #ececea;
  --sidebar-primary: oklch(0.72 0.1 255);
  --sidebar-primary-foreground: #0e1014;
  --sidebar-accent: #222220;
  --sidebar-accent-foreground: #ececea;
  --sidebar-border: #262624;
  --sidebar-ring: oklch(0.72 0.1 255);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

Notes on what changed from FE-0.2's original block, and why (each is a fix to a finding in [`11-design-system.md`](11-design-system.md) §8, not a stylistic preference):

- `--syntax-comment` was **dropped**; nothing references it. Any syntax highlighter config (Monaco theme, §6 below) uses `--faint-foreground` for comments per finding 3.
- `--ring` stores the opaque hex-equivalent color, not the alpha `oklch(… / .45)` from the raw export, per finding 2.
- `--destructive-foreground` differs by theme (`#ffffff` light, theme `background` dark) per finding 1, instead of the hardcoded `#ffffff` every shadcn destructive variant assumes.
- `font: inter` → Geist (§2 above); no remaining Google Fonts `@import`.
- Radius base changed from `0.625rem` to `0.5rem` so the derived scale lands on the design's 4/6/8/10px steps exactly (`0.625rem` base would give 6/8.5/10/12px, off-scale).

## 4. shadcn-vue component edits (FE-0.2 step 3, after `add`)

FE-0.2 step 3 runs `npx shadcn-vue@2.8.2 add -y button input label textarea field card dialog alert-dialog sheet tabs badge dropdown-menu avatar separator scroll-area resizable tooltip sonner skeleton spinner empty alert collapsible select switch`. Add this as **step 3b**, immediately after: targeted class edits so the generated components match the radius/shadow/motion rules in [`11-design-system.md`](11-design-system.md) §4, §6, §7. All edits are class-string changes only — no component logic changes, no new props.

| File                                                                                                      | Change                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/ui/badge/index.ts`                                                                            | `rounded-4xl` → `rounded-sm` (4px square badges, not pills — design §4)                                                                                                                                                                           |
| `components/ui/dialog/DialogContent.vue`, `alert-dialog/AlertDialogContent.vue`                           | confirm `rounded-xl` maps to the new 10px `--radius-xl` (no class change needed — verify after §3's radius-base fix)                                                                                                                              |
| `components/ui/dialog/DialogOverlay.vue`, `alert-dialog/AlertDialogOverlay.vue`, `sheet/SheetOverlay.vue` | `bg-black/10 supports-backdrop-filter:backdrop-blur-xs` / `bg-black/80` → `bg-scrim` (flat, no blur — design §1.1 "no glassmorphism")                                                                                                             |
| `components/ui/skeleton/Skeleton.vue`                                                                     | `bg-muted animate-pulse` → `bg-muted animate-pulse-opacity` — add a `@utility pulse-opacity` in `main.css` step 3 (`opacity: 1 / .5` keyframe, no color shift) so skeletons don't pulse toward a different hue (design §6 "opacity-only shimmer") |
| `components/ui/button/index.ts` (destructive variant)                                                     | `bg-destructive/10 … text-destructive` → `bg-destructive text-destructive-foreground` (solid fill per design §7, not a tinted-text ghost button; `--destructive-foreground` already carries the per-theme fix from §3 above)                      |
| `components/ui/sonner/Sonner.vue`                                                                         | `classes: { toast: 'rounded-2xl' }` → `'rounded-lg'` (8px, matches design §4 toast radius, not the CLI default)                                                                                                                                   |
| `components/ui/input/Input.vue`, `textarea/Textarea.vue`                                                  | confirm `text-base md:text-sm` is kept as-is (16px on phones prevents iOS auto-zoom on focus; 13px `text-sm` desktop matches design) — no change, called out so it isn't "fixed" by mistake                                                       |

Step 5 (verify) gains: after the edits, `npm run typecheck` and `grep -rL "text-sm\b" src/components/ui | grep -c rounded-4xl` returns `0`.

## 5. Genesis components (design system §6-7 → code)

New shared components under `src/components/common/`, added to FE-0.6 (currently `PageState.vue · RelativeTime.vue · OfflineBanner.vue · ThemeToggle.vue · ConfirmDialog.vue` per [`09-frontend-implementation-plan/00-overview.md`](09-frontend-implementation-plan/00-overview.md) line 62):

| Component          | Props                                                                                | Renders                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `StatusDot.vue`    | `state: 'active' \| 'positive' \| 'warning' \| 'negative' \| 'off'`, `size?: 7 \| 6` | 7×7px filled circle (+ soft halo when `active`) or hollow ring, per design §6                                     |
| `StatusBadge.vue`  | `label: string`, `tone: 'ok' \| 'warn' \| 'err' \| 'neutral'`                        | `StatusDot` + word, `text-xs`, used for Connected/Reconnect required/Rejected/Not connected                       |
| `VersionBadge.vue` | `n: number`, `current?: boolean`                                                     | monospace `v{n}` chip (`line2` border) + optional "Current" pill (`primary-soft`/`primary`)                       |
| `Kbd.vue`          | `keys: string[]`                                                                     | `⌘` `Enter` style key caps, `font-mono text-2xs`, `line` border, 3px radius                                       |
| `InlineNotice.vue` | `tone`, `icon?`, slot                                                                | the recurring bordered/tinted single-line notice (offline banner, rate-limit strip, HighLevel-not-connected hint) |

These wrap existing shadcn primitives (Badge, Alert) with the design's exact spacing/icon pairing — they don't replace FE-0.6's existing `PageState`/`OfflineBanner`, they factor out the pattern those already use twice.

## 6. Monaco editor theme (FE-5.1, `06-code-editor.md`)

Monaco cannot read CSS custom properties or `oklch()` — its `editor.defineTheme` API needs literal 6-digit hex. Add a `monaco-theme.ts` (new file, `src/features/workspace/editor/monaco-theme.ts`) defining two themes from [`11-design-system.md`](11-design-system.md) §2 hex column:

```ts
import type * as Monaco from 'monaco-editor';

const base = {
  rules: [
    { token: 'comment', foreground: '' }, // set per theme below (faint-foreground, finding 3)
  ],
};

export function defineGenesisThemes(monaco: typeof Monaco) {
  monaco.editor.defineTheme('genesis-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6f6e68' },
      { token: 'keyword', foreground: '215da5' },
      { token: 'string', foreground: '346c42' },
      { token: 'number', foreground: '94582a' },
      { token: 'type', foreground: '00686c' },
    ],
    colors: {
      'editor.background': '#fcfcfb',
      'editor.foreground': '#1a1a19',
      'editorLineNumber.foreground': '#6f6e68',
      'editorLineNumber.activeForeground': '#57564f',
      'editor.selectionBackground': '#e4f0ff',
      'editorCursor.foreground': '#2e64a6',
    },
  });
  monaco.editor.defineTheme('genesis-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '85847d' },
      { token: 'keyword', foreground: '85b4f0' },
      { token: 'string', foreground: '87c293' },
      { token: 'number', foreground: 'e3b47d' },
      { token: 'type', foreground: '76c7cc' },
    ],
    colors: {
      'editor.background': '#121211',
      'editor.foreground': '#ececea',
      'editorLineNumber.foreground': '#85847d',
      'editorLineNumber.activeForeground': '#a6a59f',
      'editor.selectionBackground': '#202f42',
      'editorCursor.foreground': '#79a7e2',
    },
  });
}
```

[`09-frontend-implementation-plan/06-code-editor.md`](09-frontend-implementation-plan/06-code-editor.md) line ~1053 (`:theme="props.theme === 'dark' ? 'vs-dark' : 'vs'"`) changes to `'genesis-dark' : 'genesis-light'`, and `defineGenesisThemes(monaco)` is called once in the Monaco loader's `onMount`/`beforeMount` hook (same file, where the worker paths are configured).

## 7. Screens — deltas from the current plan

The plan (`09-frontend-implementation-plan/`) decides **what** ships; this design decides **how it looks**. Three places where the plan's current layout differs from the design, resolved here:

1. **Dashboard project list — rows, not cards.** [`09-frontend-implementation-plan/03-dashboard-and-highlevel-connection.md`](09-frontend-implementation-plan/03-dashboard-and-highlevel-connection.md) line ~1296 uses `grid grid-cols-[auto_1fr] … sm:grid-cols-2 lg:grid-cols-3` (`ProjectCard.vue` in a card grid). The design uses a single-column list (name / files / updated / row-menu, `grid-template-columns: minmax(0,1fr) 90px 130px 40px`, [`11-design-system.md`](11-design-system.md) §5). **Change:** replace the `grid … sm:grid-cols-2 lg:grid-cols-3` wrapper and `ProjectCard.vue` with a `<div class="divide-y divide-border rounded-lg border">` list and a `ProjectRow.vue` (same props/emits as `ProjectCard.vue` — `project`, `@open`, `@rename`, `@delete` — so FE-3's composable and tests are unaffected, only the presentation component changes).
2. **Workspace panel default sizes.** [`09-frontend-implementation-plan/04-workspace-shell-and-chat.md`](09-frontend-implementation-plan/04-workspace-shell-and-chat.md) line ~424-432 uses `:default-size="28"` / `40` / `32`. The design's fixed panel widths (344 / flexible / 520px, §5) work out to roughly 24 / 40 / 36 at a 1440px reference width. **Change:** `:default-size="24"` (chat), `"40"` (code, unchanged), `"36"` (preview); `:min-size` values (20/25/20) are unchanged — they're a usability floor, not a design value.
3. **Third example prompt.** The design's `ExamplePrompts.vue` content (design export, Workspace moment=empty) lists "Find open slots on a calendar for the next 7 days," which calls `calendars.freeSlots` — an **extension** method, off by default (`HL_EXTENDED_METHODS=false`, [`08-backend-implementation-plan/01-foundation.md`](08-backend-implementation-plan/01-foundation.md)). Showing it as a default example would suggest capability the sandbox doesn't grant out of the box. **Change:** in [`09-frontend-implementation-plan/04-workspace-shell-and-chat.md`](09-frontend-implementation-plan/04-workspace-shell-and-chat.md) `ExamplePrompts.vue`, replace it with **"Upcoming appointments grouped by calendar"** — exercises only core (always-enabled) methods `calendars.list` + `calendars.events`.

Everything else in the design (auth, connection card, chat transcript states, file tree, editor chrome, console/calls drawer, version history sheet, toasts, dialogs, empty/loading/error states) matches what the plan already builds — no scope change, only the token/component substitutions in §3-§6 above.

Built: the **diff dialog** (FE-7.3, bonus R-B3 — [`11-design-system.md`](11-design-system.md) §10).

## 8. Verification

Add to FE-0.2 step 5 (currently "`ls src/components/ui` lists 25 folders; `npm run typecheck` passes"):

```bash
npm run typecheck && npm run lint
npm run build && npm run check:bundle   # confirms Geist swap didn't move the 350 KB gzip budget
```

Manual spot-check (once FE-1/FE-2/FE-4 land): open the app in both themes, tab to a button/input/link — the focus ring must be visibly a colored outline, not a barely-there haze (this is the regression finding 2 in [`11-design-system.md`](11-design-system.md) §8 would otherwise reintroduce silently, since it fails visually but not in any automated test).

## 9. Task-list delta

| Task                                                | Change                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| FE-0.2                                              | Font swap (§2), full `main.css` replacement (§3), new step 3b component edits (§4) |
| FE-0.6                                              | Add `StatusDot`, `StatusBadge`, `VersionBadge`, `Kbd`, `InlineNotice` (§5)         |
| FE-3.x (`03-dashboard-and-highlevel-connection.md`) | `ProjectCard.vue` → `ProjectRow.vue`, grid → list (§7.1)                           |
| FE-4.x (`04-workspace-shell-and-chat.md`)           | Panel `:default-size` values (§7.2), `ExamplePrompts.vue` third item (§7.3)        |
| FE-5.1 (`06-code-editor.md`)                        | New `monaco-theme.ts`, theme prop values `genesis-light`/`genesis-dark` (§6)       |
| FE-7.3                                              | Built — View changes opens the diff dialog                                         |

No backend, contract, or runtime-manifest change is implied by this document.
