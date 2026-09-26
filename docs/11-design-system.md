# Genesis — Design System

**Status:** Approved
**Date:** 2026-09-26
**Source:** Claude Design export at `/Users/mac/Downloads/Genesis UI design system/` (7 `.dc.html` screens + `Foundations.dc.html`), produced from [`prompts/01-claude-design-genesis-ui.md`](prompts/01-claude-design-genesis-ui.md). That folder is a Claude Design artifact (renders only inside Claude Design's own viewer, `support.js`); this document is the extracted, implementation-ready record of it and is what the frontend plan builds against. The export itself is not, and does not need to be, committed.
**Used by:** [`12-frontend-design-implementation.md`](12-frontend-design-implementation.md) (how it's built), [`09-frontend-implementation-plan/`](09-frontend-implementation-plan/00-overview.md) (where it's applied task by task).

---

## 1. Principles

From the design brief ([`prompts/01`](prompts/01-claude-design-genesis-ui.md)), non-negotiable:

1. **No "AI slop."** No gradients, sparkle/magic-wand/robot icons, glassmorphism, glow, confetti, chat-bubble consumer styling, pill-soup rounding, or marketing copy ("Unleash your creativity"). The AI is a capability, described in plain factual language: "Reading project", "Writing app.js", "Saved as version 4" — never animated "thinking" language.
2. **Status is never color alone.** Every state pairs a shape (filled dot / hollow dot / check / `!` / `×`) with a word.
3. **One accent, used sparingly** — primary actions and focus only. Semantic colors (success/warning/error) are muted, never loud fills.
4. **Two fonts.** One sans for UI, one mono for code, file paths, IDs and version numbers. Hierarchy comes from weight/size/color, not decoration.
5. **Density matches the screen.** Calm and spacious on auth/dashboard; information-dense in the workspace (file tree, chat, version list).
6. **Minimal, functional motion only.** No bouncy/playful animation, no pulsing-color skeletons (skeletons pulse opacity only, see §7).
7. **Built from shadcn-vue primitives only** — Button, Input, Select, Switch, Badge, Alert, Dialog, AlertDialog, Sheet, Tabs, DropdownMenu, Tooltip, Sonner toasts, Skeleton, Resizable, ScrollArea. No exotic custom widgets.
8. **Both themes are equally considered**, not light-with-a-dark-mode-afterthought.

## 2. Color

Values are the export's own tokens (`oklch()` where the design specified perceptual color; flat hex elsewhere). Hex equivalents for tooling that needs sRGB (Monaco theme, `<meta name="theme-color">`) are given alongside; they're derived by exact OKLCH→sRGB conversion, not eyeballed.

### 2.1 Light

| Token | Value | Hex | Role |
|---|---|---|---|
| `bg` | `#f7f7f6` | `#f7f7f6` | App background |
| `panel` | `#ffffff` | `#ffffff` | Header, cards, dialogs, menus, editor chrome |
| `sub` | `#f2f2f0` | `#f2f2f0` | Skeleton fill, muted rows, drawer background |
| `hover` | `#ececea` | `#ececea` | Row/menu-item hover |
| `line` | `#e6e5e2` | `#e6e5e2` | Default border/divider |
| `line2` | `#d6d5d1` | `#d6d5d1` | Stronger border (inputs, secondary buttons) |
| `fg` | `#1a1a19` | `#1a1a19` | Primary text |
| `fg2` | `#57564f` | `#57564f` | Secondary text |
| `fg3` | `#6f6e68` | `#6f6e68` | Faint text, placeholders, metadata |
| `acc` | `oklch(0.5 0.12 255)` | `#2e64a6` | Accent — primary actions, links, active state |
| `acc-h` | `oklch(0.45 0.12 255)` | `#1f5596` | Accent hover |
| `acc-fg` | `#ffffff` | `#ffffff` | Text/icon on accent fill |
| `acc-soft` | `oklch(0.95 0.025 255)` | `#e4f0ff` | Accent tint (badges, selected tab) |
| `ring` | `oklch(0.62 0.13 255)` | `#4c88d3` | Focus ring — **store opaque**, see §8 finding 2 |
| `ok` | `oklch(0.5 0.09 150)` | `#397247` | Success |
| `ok-soft` | `oklch(0.95 0.03 150)` | `#e1f5e4` | Success tint |
| `warn` | `oklch(0.52 0.1 70)` | `#8d5d1c` | Warning |
| `warn-soft` | `oklch(0.96 0.035 85)` | `#fdf1d8` | Warning tint |
| `err` | `oklch(0.52 0.14 27)` | `#ab413a` | Error/destructive |
| `err-soft` | `oklch(0.96 0.02 27)` | `#ffedeb` | Error tint |
| `code` | `#fcfcfb` | `#fcfcfb` | Editor/code-block background |
| `syn-kw` | `oklch(0.48 0.13 255)` | `#215da5` | Syntax: keyword |
| `syn-str` | `oklch(0.48 0.09 150)` | `#346c42` | Syntax: string |
| `syn-num` | `oklch(0.52 0.1 55)` | `#94582a` | Syntax: number |
| `syn-com` | `#8a8983` | `#8a8983` | Syntax: comment — **use `fg3` instead**, see §8 finding 3 |
| `syn-prop` | `oklch(0.47 0.08 200)` | `#00686c` | Syntax: property/CSS key |
| `scrim` | `rgba(20,20,18,.28)` | — | Dialog/sheet backdrop |
| `shadow` | `0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.08)` | — | Popover/dialog/toast elevation |

### 2.2 Dark

| Token | Value | Hex | Role |
|---|---|---|---|
| `bg` | `#0f0f0e` | `#0f0f0e` | App background |
| `panel` | `#151514` | `#151514` | Header, cards, dialogs, menus |
| `sub` | `#1b1b1a` | `#1b1b1a` | Skeleton fill, muted rows |
| `hover` | `#222220` | `#222220` | Row/menu-item hover |
| `line` | `#262624` | `#262624` | Default border/divider |
| `line2` | `#34332f` | `#34332f` | Stronger border |
| `fg` | `#ececea` | `#ececea` | Primary text |
| `fg2` | `#a6a59f` | `#a6a59f` | Secondary text |
| `fg3` | `#85847d` | `#85847d` | Faint text, placeholders |
| `acc` | `oklch(0.72 0.1 255)` | `#79a7e2` | Accent |
| `acc-h` | `oklch(0.78 0.09 255)` | `#90baf1` | Accent hover |
| `acc-fg` | `#0e1014` | `#0e1014` | Text/icon on accent fill (dark text on light accent) |
| `acc-soft` | `oklch(0.3 0.04 255)` | `#202f42` | Accent tint |
| `ring` | `oklch(0.72 0.1 255)` | `#79a7e2` | Focus ring — opaque |
| `ok` | `oklch(0.74 0.09 150)` | `#81bb8d` | Success |
| `ok-soft` | `oklch(0.28 0.035 150)` | `#1c2e20` | Success tint |
| `warn` | `oklch(0.78 0.1 80)` | `#d9b06b` | Warning |
| `warn-soft` | `oklch(0.29 0.04 80)` | `#362913` | Warning tint |
| `err` | `oklch(0.72 0.12 27)` | `#e6867b` | Error/destructive |
| `err-soft` | `oklch(0.29 0.05 27)` | `#41211e` | Error tint |
| `code` | `#121211` | `#121211` | Editor/code-block background |
| `syn-kw` | `oklch(0.76 0.1 255)` | `#85b4f0` | Syntax: keyword |
| `syn-str` | `oklch(0.76 0.09 150)` | `#87c293` | Syntax: string |
| `syn-num` | `oklch(0.8 0.09 70)` | `#e3b47d` | Syntax: number |
| `syn-com` | `#6f6e68` | `#6f6e68` | Syntax: comment — use `fg3` instead |
| `syn-prop` | `oklch(0.78 0.08 200)` | `#76c7cc` | Syntax: property/CSS key |
| `scrim` | `rgba(0,0,0,.55)` | — | Dialog/sheet backdrop |
| `shadow` | `0 1px 2px rgba(0,0,0,.4), 0 12px 32px rgba(0,0,0,.5)` | — | Elevation |

### 2.3 shadcn variable mapping

The design's tokens are the *values*; shadcn-vue's `components.json` (`baseColor: neutral`, style `reka-nova`) defines the *variable names* every generated component already reads. Map one to the other — don't rename shadcn's variables, don't add new colors inside `.vue` files:

| shadcn variable | Design token | Note |
|---|---|---|
| `--background` | `bg` | |
| `--foreground` | `fg` | |
| `--card`, `--popover` | `panel` | |
| `--card-foreground`, `--popover-foreground` | `fg` | |
| `--primary` | `acc` | **shadcn's "primary" is the design's "accent."** |
| `--primary-foreground` | `acc-fg` | |
| `--muted` | `sub` | |
| `--muted-foreground` | `fg2` | design has two muted levels (`fg2`, `fg3`); shadcn has one — add `--faint-foreground: fg3` (custom token, §3 of the implementation doc) |
| `--accent` | `hover` | **shadcn's "accent" is a hover surface, not the brand color** — do not confuse with `--primary` |
| `--accent-foreground` | `fg` | |
| `--border` | `line` | |
| `--input` | `line2` | |
| `--ring` | `ring` (opaque form) | see §8 finding 2 |
| `--destructive` | `err` | |
| `--success` (custom, already in FE-0.2) | `ok` | |
| `--warning` (custom, already in FE-0.2) | `warn` | |
| new: `--code` | `code` | editor/code-block background |
| new: `--syntax-keyword/-string/-number/-comment/-property` | `syn-*` | Monaco theme + any inline code samples |
| new: `--scrim` | `scrim` | dialog/sheet backdrop |

## 3. Typography

**Fonts:** Geist (UI) and Geist Mono (code, file paths, IDs, version numbers, keyboard shortcuts). Weights used: 400, 500, 600 only — never 700+.

| Role | Size / weight / spacing | Sample | Tailwind scale name |
|---|---|---|---|
| Page title (Dashboard "Projects") | 22px / 600 / −1.5% | "Projects" | `text-2xl` |
| Auth title | 20px / 600 | "Sign in to Genesis" | `text-xl` |
| Page-state title (404, error pages) | 18px / 600 | "Project not found" | `text-lg` |
| Dialog / sheet title | 15px / 600 | "Version history" | `text-md` *(new step, see §12 impl doc)* |
| Body — auth & dashboard | 14px / 400 | "Connect a location so your apps can read its data." | `text-base` |
| Body — workspace (default UI size) | 13px / 400–500 | "Restored version 2 as version 4" | `text-sm` |
| Caption / metadata | 12px / 400 | "12 min ago · 4 files changed" | `text-xs` |
| Mono — code line, file path | 12px / 400 | `js/appointments.js` | `font-mono text-xs` |
| Mono — version tag, shortcut key | 11px / 500 | `v6` `⌘S` `429` `184 ms` | `font-mono text-2xs` *(new step)* |

Values between these (11.5, 12.5, 13.5, 14.5) in the export are rounding artifacts of the design tool — they collapse onto the scale above; do not add extra steps for them.

Line height 1.45 throughout (matches Tailwind's default body leading — no override needed except on the 22px/18px/15px titles, which use tighter leading per the table above).

## 4. Spacing, radius, shadow

- **Spacing:** 4px base unit — `4·8·12·16·20·24·32·48`. This is Tailwind's default `--spacing` scale; no change needed.
- **Radius:**

  | Radius | Used for |
  |---|---|
  | 4px | Badges |
  | 5px | Menu items, select triggers |
  | 6px | Buttons, inputs, small cards, chat bubbles |
  | 8px | Cards, dropdown/context menus, toasts, code blocks |
  | 10px | Dialogs, side sheets |
  | full | Avatars, switch, status dots |

- **Shadow:** exactly one elevation value per theme (§2.1/§2.2 `shadow` token), used for popovers, dialogs, dropdowns and toasts. Nothing else gets a shadow — cards, rows and panels are separated by `border` only.
- **Backdrop:** `scrim` token behind dialogs/sheets — flat semi-transparent color, **no blur** (no glassmorphism, principle §1.1).

## 5. Layout

| Surface | Dimension |
|---|---|
| Dashboard/auth header height | 52px (dashboard) / 64px (auth) |
| Workspace header height | 48px |
| Workspace panels at ≥1024px | Chat `0 0 344px` · Code `1 1 0` (flexible) · Preview `0 0 520px`, each resizable with a draggable 1px divider |
| Workspace panels at <1024px ("narrow", tested at 390px) | Collapse to a 3-way segmented control (Chat / Code / Preview); **all three stay mounted** so a running stream, Monaco's model and the preview iframe survive the tab switch |
| Preview console/calls drawer | 236px fixed height, bottom-docked, 2 tabs |
| Code panel file tree | 196px fixed width (wide only; hidden when narrow) |
| Version history sheet | 440px wide, right-docked |
| Diff dialog | 1160×720px, centered — **not built in v1**, see §7 of the implementation doc |
| Content max-width (auth) | 340px |
| Content max-width (dashboard) | 1040px |

## 6. Iconography and motion

- Icons: 12–16px outline strokes, `stroke-width` 1.4–1.6, from `@lucide/vue` (already the frontend's icon package). The export draws its own inline SVGs with these exact proportions; use the matching Lucide icon rather than redrawing (e.g. the checkmark → `CheckIcon`, the warning triangle → `TriangleAlertIcon`, the circled `!` → `CircleAlertIcon`, the circled `×` → `CircleXIcon` sized to 16px).
- **Status dot** — the recurring shape for "is this thing on": a 7×7px filled circle for a positive/active state (`ok`/`acc`, with a soft `box-shadow: 0 0 0 3px <color>-soft` halo when actively in-progress), or a 6×6/7×7px hollow ring (`border: 1.5px solid var(--fg3)` or `line2`) for "not connected / not started." Never a bare color fill with no shape distinction from its neighbor.
- **Motion:** a 1–2px accent progress bar for "rebuilding," a blinking-caret block cursor for streaming text, opacity-only skeleton shimmer (no color pulse), 100–150ms transitions on hover/open. No spinners longer than the small inline dual-tone circle used on busy buttons; no full-screen loading animations.

## 7. Component states

Every interactive component needs Default / Hover / Focus / Disabled states; primary actions also need Loading.

| Component | Default | Hover | Focus | Disabled | Loading |
|---|---|---|---|---|---|
| Primary button | `acc` fill, `acc-fg` text | `acc-h` fill | + double ring: `0 0 0 2px panel, 0 0 0 4px ring` | 45% opacity | 70% opacity + spinning ring + label change ("Saving") |
| Secondary button | `panel` fill, `line2` border | `hover` fill | `acc` border + `0 0 0 3px ring` | `fg3` text, `line` border | spinner + label change ("Retrying") |
| Destructive button | `err` fill, white text (dark theme: use `bg`-colored text, see §8 finding 1) | `filter: brightness(.92)` | double ring in `err-soft` | 45% opacity | spinner + label change ("Deleting") |
| Input | `line2` border | — | `acc` border + `0 0 0 3px ring` | `sub` fill, `fg3` text | — |
| Input (error) | `err` border, error text below in `err` | — | — | — | — |

Badge/status vocabulary (icon shape + word, never color alone):
- `v6` — monospace version chip, `line2` border, no fill.
- **Current** — `acc-soft` fill, `acc` text.
- **Connected** — filled dot (`ok`) + word.
- **Reconnect required** — filled dot (`warn`) + word.
- **Rejected** — filled dot (`err`) + word.
- **Not connected** — hollow ring dot + word.

## 8. Accessibility — verified findings

Contrast checked by converting every OKLCH token to sRGB and computing WCAG relative-luminance ratios (script in the implementation doc's verification step). All text/background pairs pass AA (≥4.5:1 body, ≥3:1 large text and UI components) **except**:

1. **Dark-theme destructive button:** white label on `err` (`#e6867b`) is 2.61:1 — fails. Fix: use the theme's `bg` color (`#0f0f0e`) as the label instead of white; gives 7.35:1. (Light theme's white-on-`err` is fine at 5.91:1 — no change there.)
2. **Focus ring is invisible.** The design's `ring` token already carries alpha (`oklch(.62 .13 255 / .45)` light, `/.5` dark). shadcn-vue's own utility classes (`ring-3 ring-ring/50`, `focus-visible:ring-ring/50`) apply a **second** 50% alpha on top, compounding to ~22% opacity — contrast against `panel` drops to 1.29:1 (light) / 1.57:1 (dark), i.e. not visibly there. **Fix:** store `--ring` as the fully opaque hex (`#4c88d3` light, `#79a7e2` dark) so shadcn's own `/50` gives the intended halo; verified opaque-ring-at-50%-alpha gives 1.81:1 (light) / 2.75:1 (dark) contrast for the halo itself, while the solid `focus-visible:border-ring` edge (used by inputs) reaches 3.65:1 / 7.38:1 — both meet the ≥3:1 non-text UI-component bar.
3. **Syntax comment color fails on code background:** `syn-com` gives 3.42:1 (light) / 3.67:1 (dark) against `code` — below the 4.5:1 body-text bar (comments are read as text, not decoration). **Fix:** use `fg3` for comments instead (4.98:1 light / 4.99:1 dark); drop the separate `syn-com` token.

No other pair needs a change — the lowest surviving ratio is 4.56:1 (`fg3` on `sub`, light theme).

## 9. Copy rules

- Status/progress text is factual, present-tense, specific: "Reading project" → "Planning" → "Writing js/appointments.js" → "Checking files" → "Saving" — never "Thinking…" or "Working my magic."
- Errors name the problem and the next action: "Couldn't load projects — The server didn't respond in time. Your projects are safe. [Retry]" — never a bare "Something went wrong" with no cause or action.
- Empty states: one line of guidance + one action, no illustration: "No projects yet — Create a project, then describe the app you want in chat. [Create your first project]"
- Destructive confirmations state the concrete, irreversible consequence with real numbers: "Delete "Lead intake form"? Its 3 files and 4 versions are deleted permanently. This can't be undone."
- Never emoji, never exclamation-heavy copy, never "Welcome back 👋" filler.

## 10. What this design system does not cover

Two things appear in the export that are explicitly **out of v1** per [`08-backend-implementation-plan/09-hardening-bonuses-and-deploy.md`](08-backend-implementation-plan/09-hardening-bonuses-and-deploy.md) and [`09-frontend-implementation-plan/08-snapshots-and-diff.md`](09-frontend-implementation-plan/08-snapshots-and-diff.md) FE-7.3 — their visual spec is kept here for the record but there is no task building them:

- The **diff dialog** ("View changes", side-by-side file diff) — bonus R-B3, not built.
- The **HighLevel calls drawer tab** content is fine (it reflects real `runtime.service` calls, FE-6/FE-7), but its sample numbers (`184 ms`, `429 Rate limited`) are illustrative only, not literal fixtures.

Sample code shown inside the design mockups (`hl.request('contacts.search', …)`, a free-slots example) uses a different runtime-call shape than our actual `window.genesis.highlevel.<method>` SDK (contracts in [`07-end-to-end-system-design.md`](07-end-to-end-system-design.md) §3) — treat it as illustrative chat/editor content, not an API to implement. The third example prompt in the design ("Find open slots on a calendar for the next 7 days") uses `calendars.freeSlots`, an **extension** method disabled by default (see [`08-backend-implementation-plan/01-foundation.md`](08-backend-implementation-plan/01-foundation.md) `HL_EXTENDED_METHODS`); the implementation doc swaps it for a core-method example.
