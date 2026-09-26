# FE-0 — Foundation

> Read [`00-overview.md`](00-overview.md) first (Global Constraints, Coding Standards). Spec: [`../06-frontend-system-design.md`](../06-frontend-system-design.md) §1–§5. Every code block in this plan was compiled, linted, tested and built together (vue-tsc, ESLint type-aware, Vitest, `vite build`) against the exact versions pinned below before it was written here.

---

### Task FE-0.1: Scaffold the Vue + TypeScript project

**Files:**
- Create: `frontend/package.json`, `frontend/index.html`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/tsconfig.app.json`, `frontend/tsconfig.node.json`, `frontend/tsconfig.vitest.json`, `frontend/src/env.d.ts`, `frontend/public/favicon.svg`
- Generated: `frontend/src/contracts/*` (root `npm run contracts:sync`)

**Interfaces:** Produces npm scripts `dev`, `build`, `preview`, `typecheck`, `lint`, `format`, `test`, `check:bundle`, and the `@/` import alias used by every later task.

- [ ] **Step 1: Create the folder and `package.json`** (write the files by hand rather than running `npm create vue` — the result must match this plan exactly)

`frontend/package.json`:
```json
{
  "name": "genesis-frontend",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "engines": {
    "node": ">=24 <25"
  },
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --build && vite build",
    "preview": "vite preview",
    "typecheck": "vue-tsc --build",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write \"src/**/*.{ts,vue,css}\" \"tests/**/*.ts\"",
    "test": "vitest run",
    "test:watch": "vitest",
    "check:bundle": "node scripts/check-bundle.mjs"
  },
  "dependencies": {
    "@fontsource-variable/inter": "^5.3.0",
    "@guolao/vue-monaco-editor": "^1.6.0",
    "@lucide/vue": "^1.48.0",
    "@vueuse/core": "^15.0.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "eventsource-parser": "^4.1.1",
    "firebase": "^12.19.0",
    "monaco-editor": "0.57.0",
    "pinia": "^4.0.3",
    "reka-ui": "^2.10.5",
    "tailwind-merge": "^3.7.0",
    "vue": "^3.5.43",
    "vue-router": "^5.3.1",
    "vue-sonner": "^2.0.9",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@pinia/testing": "^2.0.1",
    "@tailwindcss/vite": "^4.3.3",
    "@tsconfig/node24": "^24.0.5",
    "@types/node": "^24.13.6",
    "@vitejs/plugin-vue": "^6.0.9",
    "@vue/eslint-config-typescript": "^14.9.0",
    "@vue/test-utils": "^2.5.1",
    "@vue/tsconfig": "^0.9.1",
    "eslint": "^10.11.0",
    "eslint-config-prettier": "^10.1.8",
    "eslint-plugin-vue": "~10.11.1",
    "happy-dom": "^20.14.5",
    "prettier": "^3.9.9",
    "tailwindcss": "^4.3.3",
    "tw-animate-css": "^1.4.0",
    "typescript": "~5.9.3",
    "vite": "^8.3.1",
    "vitest": "^5.0.2",
    "vue-eslint-parser": "^10.4.1",
    "vue-tsc": "^3.3.11"
  }
}
```

> `monaco-editor` is pinned exactly: worker entry points depend on its package layout (FE-5.1). Icons come from `@lucide/vue` — the package shadcn-vue 2.8 installs (not the older `lucide-vue-next`).

- [ ] **Step 2: Create the TypeScript project references** (same layout as the official `create-vue` template; `vue-tsc --build` type-checks all three)

`frontend/tsconfig.json`:
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.vitest.json" }
  ],
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"] }
  }
}
```

> The root `compilerOptions.paths` is required: the shadcn-vue CLI reads aliases from `tsconfig.json` and fails with `resolvedPaths: Required` without it.

`frontend/tsconfig.app.json`:
```json
{
  "extends": "@vue/tsconfig/tsconfig.dom.json",
  "include": ["src/**/*.ts", "src/**/*.vue"],
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "paths": { "@/*": ["./src/*"] },
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo"
  }
}
```

`frontend/tsconfig.node.json`:
```json
{
  "extends": "@tsconfig/node24/tsconfig.json",
  "include": ["vite.config.*", "vitest.config.*", "playwright.config.*", "eslint.config.*"],
  "compilerOptions": {
    "module": "preserve",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "types": ["node"],
    "noEmit": true,
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo"
  }
}
```

`frontend/tsconfig.vitest.json`:
```json
{
  "extends": "./tsconfig.app.json",
  "include": ["tests/**/*.ts", "src/env.d.ts"],
  "exclude": [],
  "compilerOptions": {
    "types": ["node", "vite/client", "vitest/globals"],
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.vitest.tsbuildinfo"
  }
}
```

- [ ] **Step 3: Create `vite.config.ts`, `index.html`, `src/env.d.ts`, `public/favicon.svg`**

`frontend/vite.config.ts`:
```ts
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  worker: { format: 'es' },
  build: {
    sourcemap: true,
    manifest: true,
    // Monaco lives in the lazy workspace chunk and is large by nature; the entry-chunk budget is
    // enforced separately by scripts/check-bundle.mjs.
    chunkSizeWarningLimit: 6_000,
  },
});
```

`frontend/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title>Genesis</title>
    <script>
      // Apply the saved theme before first paint so dark mode doesn't flash light.
      try {
        const mode = localStorage.getItem('genesis-color-scheme') || 'auto';
        const dark =
          mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.classList.toggle('dark', dark);
      } catch {
        /* storage unavailable: keep the default theme */
      }
    </script>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`frontend/src/env.d.ts`:
```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_GENERATE_BASE_URL: string;
  readonly VITE_USE_EMULATORS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

`frontend/public/favicon.svg`:
```
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#171717"/><path d="M21.5 11.5a7 7 0 1 0 1.2 7.5H16v-3h9.8" fill="none" stroke="#fafafa" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
```

- [ ] **Step 4: Install and generate the contracts**

```bash
cd frontend
npm install
cd ..
npm run contracts:sync      # copies functions/src/contracts → frontend/src/contracts (9 files)
npm run contracts:check     # "contracts in sync (9 files)"
```

The contracts use `.js` import specifiers (NodeNext on the server); Vite and TypeScript `bundler` resolution map them to the `.ts` files, so they compile unchanged here.

- [ ] **Step 5: Temporary entry to prove the toolchain** — create `src/main.ts` with `import { createApp, h } from 'vue'; createApp({ render: () => h('p', 'Genesis') }).mount('#app');` then run `npm run dev` → http://localhost:5173 shows "Genesis". (FE-0.4 replaces this file.)

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/index.html frontend/vite.config.ts frontend/tsconfig*.json frontend/src frontend/public
git commit -m "chore(frontend): scaffold Vue 3 + Vite 8 + TypeScript project"
```

---

### Task FE-0.2: Tailwind CSS 4 and shadcn-vue (R-FE1)

**Files:**
- Create: `frontend/src/assets/main.css`, `frontend/components.json` (by the CLI), `frontend/src/lib/utils.ts` (by the CLI), `frontend/src/components/ui/**` (by the CLI)

**Interfaces:** Produces `cn()` and every UI primitive the rest of the plan imports from `@/components/ui/<name>`.

- [ ] **Step 1: Create the Tailwind entry** — `src/assets/main.css` containing only `@import "tailwindcss";`

- [ ] **Step 2: Initialize shadcn-vue** (non-interactive; verified with `shadcn-vue@2.8.2`)

```bash
cd frontend
npx shadcn-vue@2.8.2 init -t vite --base reka --style nova --icon-library lucide --font inter -b neutral -y
```

Expected `components.json`:

`frontend/components.json`:
```json
{
  "$schema": "https://shadcn-vue.com/schema.json",
  "style": "reka-nova",
  "font": "inter",
  "typescript": true,
  "tailwind": {
    "config": "",
    "css": "src/assets/main.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "rtl": false,
  "pointer": false,
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "composables": "@/composables"
  },
  "registries": {}
}
```

- [ ] **Step 3: Add every component the app uses**

```bash
npx shadcn-vue@2.8.2 add -y button input label textarea field card dialog alert-dialog sheet tabs badge \
  dropdown-menu avatar separator scroll-area resizable tooltip sonner skeleton spinner empty alert collapsible select switch
```

- [ ] **Step 4: Self-host the font and add the semantic tokens.** `--font inter` makes the CLI add a Google Fonts `@import url(...)` at the top of `main.css` but never sets `--font-sans`. Remove that import (no third-party request at runtime), install the self-hosted font, and edit `main.css` so it reads exactly:

```bash
npm install @fontsource-variable/inter@^5.3.0
```

`frontend/src/assets/main.css`:
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

@import 'tailwindcss';
@import 'tw-animate-css';

@custom-variant dark (&:is(.dark *));

@theme inline {
  --font-sans: 'Inter Variable', ui-sans-serif, system-ui, sans-serif;
  --font-heading: var(--font-sans);
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
  --color-accent-foreground: var(--accent-foreground);
  --color-accent: var(--accent);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted: var(--muted);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary: var(--secondary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary: var(--primary);
  --color-popover-foreground: var(--popover-foreground);
  --color-popover: var(--popover);
  --color-card-foreground: var(--card-foreground);
  --color-card: var(--card);
  --color-foreground: var(--foreground);
  --color-background: var(--background);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

:root {
  --radius: 0.625rem;
  --success: oklch(0.6 0.13 155);
  --warning: oklch(0.66 0.14 70);
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --chart-1: oklch(0.646 0.222 41.116);
  --chart-2: oklch(0.6 0.118 184.704);
  --chart-3: oklch(0.398 0.07 227.392);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.205 0 0);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.97 0 0);
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: oklch(0.708 0 0);
}

.dark {
  --success: oklch(0.7 0.13 155);
  --warning: oklch(0.78 0.13 80);
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: oklch(0.205 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: oklch(0.488 0.243 264.376);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.269 0 0);
  --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.556 0 0);
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

(`--success`, `--warning` are muted semantic colors used by badges and alerts; `--font-mono` is used by file paths and code.) If a Claude Design mockup was produced from [`../prompts/01-claude-design-genesis-ui.md`](../prompts/01-claude-design-genesis-ui.md), replace the token values in `:root` / `.dark` with its palette — never add colors inside components.

- [ ] **Step 5: Verify** — `ls src/components/ui` lists 25 folders; `npm run typecheck` passes.

- [ ] **Step 6: Commit** — `git add frontend && git commit -m "feat(frontend): add Tailwind 4 and shadcn-vue components"`

---

### Task FE-0.3: Lint, format and test tooling

**Files:**
- Create: `frontend/eslint.config.js`, `frontend/vitest.config.ts`, `frontend/.prettierignore`, `frontend/tests/setup.ts`, `frontend/tests/lib/time.test.ts`, `frontend/src/lib/time.ts`

**Interfaces:** Produces `formatRelative(ms, nowMs, locale?)`, `formatAbsolute(ms, locale?)`, `toMillis(value)`, `TimestampLike`.

- [ ] **Step 1: ESLint (flat config, type-aware, same layout as `create-vue`)**

`frontend/eslint.config.js`:
```js
import { globalIgnores } from 'eslint/config';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import skipFormatting from 'eslint-config-prettier/flat';
import pluginVue from 'eslint-plugin-vue';

export default defineConfigWithVueTs(
  { name: 'app/files-to-lint', files: ['**/*.{vue,ts,mts}'] },
  globalIgnores([
    '**/dist/**',
    '**/coverage/**',
    'src/components/ui/**', // shadcn-vue generated code
    'src/contracts/**', // generated from functions/src/contracts (linted there)
    'src/features/workspace/preview/runtime/**', // plain ES2020 inlined into previews; covered by tests
    'playwright-report/**',
  ]),
  ...pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommendedTypeChecked,
  {
    name: 'app/rules',
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'vue/block-lang': ['error', { script: { lang: 'ts' } }],
      'vue/component-api-style': ['error', ['script-setup']],
      'vue/define-macros-order': 'error',
      'vue/no-v-html': 'error',
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    name: 'app/tests',
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  skipFormatting,
);
```

Generated code (`components/ui`, `contracts`) and the plain-JS preview runtime (covered by its own tests, FE-6.2) are excluded.

- [ ] **Step 2: Vitest**

`frontend/vitest.config.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'happy-dom',
      // Browsers' DOMParser documents are inert; happy-dom would otherwise fetch linked files.
      environmentOptions: {
        happyDOM: {
          settings: {
            disableJavaScriptFileLoading: true,
            disableCSSFileLoading: true,
            disableIframePageLoading: true,
            handleDisabledFileLoadingAsSuccess: true,
          },
        },
      },
      globals: true,
      include: ['tests/**/*.test.ts'],
      exclude: [...configDefaults.exclude, 'e2e/**'],
      setupFiles: ['tests/setup.ts'],
      restoreMocks: true,
      root: fileURLToPath(new URL('./', import.meta.url)),
    },
  }),
);
```

`frontend/tests/setup.ts`:
```ts
import { config } from '@vue/test-utils';

// Reka primitives portal into document.body; keep tests deterministic and quiet.
config.global.stubs = { teleport: true };
```

`frontend/.prettierignore`:
```
dist
coverage
src/components/ui
src/contracts
```

Prettier uses the root `.prettierrc.json` (BE-0.1).

- [ ] **Step 3: Write the first failing test**

`frontend/tests/lib/time.test.ts`:
```ts
import { formatRelative, toMillis } from '@/lib/time';

describe('time helpers', () => {
  const now = Date.UTC(2026, 9, 1, 12);
  it('formats relative times', () => {
    expect(formatRelative(now - 10_000, now, 'en')).toBe('just now');
    expect(formatRelative(now - 5 * 60_000, now, 'en')).toBe('5 minutes ago');
    expect(formatRelative(now - 3 * 3_600_000, now, 'en')).toBe('3 hours ago');
    expect(formatRelative(now - 86_400_000, now, 'en')).toBe('yesterday');
  });
  it('accepts Firestore timestamps, dates, numbers and null', () => {
    expect(toMillis({ toMillis: () => 5 })).toBe(5);
    expect(toMillis(new Date(7))).toBe(7);
    expect(toMillis(null)).toBeNull();
  });
});
```

Run: `npm test -- tests/lib/time.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement**

`frontend/src/lib/time.ts`:
```ts
export type TimestampLike = { toMillis(): number } | Date | number | null | undefined;

export function toMillis(value: TimestampLike): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  return value.toMillis();
}

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

export function formatRelative(ms: number, nowMs: number, locale?: string): string {
  const diff = ms - nowMs;
  if (Math.abs(diff) < 45_000) return 'just now';
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size || unit === 'minute')
      return rtf.format(Math.round(diff / size), unit);
  }
  return 'just now';
}

export function formatAbsolute(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
}
```

- [ ] **Step 5: Run** `npm test` → PASS; `npm run lint` → clean.

> Vitest pitfall: never write `beforeEach(() => mock.mockReset())` — Vitest 5 treats a function returned from `beforeEach` as a cleanup hook and calls the mock with no arguments. Use a block body.

- [ ] **Step 6: Commit** — `chore(frontend): add ESLint, Prettier and Vitest`

---

### Task FE-0.4: Environment validation, Firebase and emulators

**Files:**
- Create: `frontend/src/lib/env.ts`, `frontend/src/lib/firebase.ts`, `frontend/src/app/config-error.ts`, `frontend/.env.example`, `frontend/.env.production`, `frontend/.env.local` (git-ignored)
- Modify: root `.gitignore` (allow the public production env file)
- Test: `frontend/tests/lib/env.test.ts`

**Interfaces:** Produces `parseEnv(raw): EnvResult`, `Env`, `initFirebase(env)`, `auth()`, `db()`, `renderConfigError(problems)`.

- [ ] **Step 1: Failing test**

`frontend/tests/lib/env.test.ts`:
```ts
import { parseEnv } from '@/lib/env';

const valid = {
  VITE_FIREBASE_API_KEY: 'key',
  VITE_FIREBASE_AUTH_DOMAIN: 'x.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'x',
  VITE_FIREBASE_APP_ID: '1:2:web:3',
  VITE_API_BASE_URL: 'https://us-central1-x.cloudfunctions.net/api/',
  VITE_GENERATE_BASE_URL: 'https://us-central1-x.cloudfunctions.net/generate',
};

describe('parseEnv', () => {
  it('normalizes base URLs and defaults emulators off', () => {
    const result = parseEnv(valid);
    expect(result.ok && result.env.apiBaseUrl).toBe('https://us-central1-x.cloudfunctions.net/api');
    expect(result.ok && result.env.useEmulators).toBe(false);
  });

  it('lists every problem instead of failing silently', () => {
    const result = parseEnv({
      ...valid,
      VITE_FIREBASE_API_KEY: '',
      VITE_API_BASE_URL: 'not a url',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.join('\n')).toMatch(/VITE_FIREBASE_API_KEY/);
      expect(result.problems.join('\n')).toMatch(/VITE_API_BASE_URL/);
    }
  });
});
```

- [ ] **Step 2: Implement**

`frontend/src/lib/env.ts`:
```ts
import { z } from 'zod';

const BaseUrl = z.url().transform((u) => u.replace(/\/+$/, ''));

const EnvSchema = z.object({
  VITE_FIREBASE_API_KEY: z.string().min(1),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  VITE_FIREBASE_PROJECT_ID: z.string().min(1),
  VITE_FIREBASE_APP_ID: z.string().min(1),
  VITE_API_BASE_URL: BaseUrl,
  VITE_GENERATE_BASE_URL: BaseUrl,
  VITE_USE_EMULATORS: z.enum(['true', 'false']).default('false'),
});

export interface Env {
  readonly firebase: { apiKey: string; authDomain: string; projectId: string; appId: string };
  readonly apiBaseUrl: string;
  readonly generateBaseUrl: string;
  readonly useEmulators: boolean;
}

export type EnvResult = { ok: true; env: Env } | { ok: false; problems: string[] };

/** Validates the Vite env once at startup; invalid config renders a readable screen instead of a blank page. */
export function parseEnv(raw: Record<string, unknown>): EnvResult {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }
  const e = parsed.data;
  return {
    ok: true,
    env: {
      firebase: {
        apiKey: e.VITE_FIREBASE_API_KEY,
        authDomain: e.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: e.VITE_FIREBASE_PROJECT_ID,
        appId: e.VITE_FIREBASE_APP_ID,
      },
      apiBaseUrl: e.VITE_API_BASE_URL,
      generateBaseUrl: e.VITE_GENERATE_BASE_URL,
      useEmulators: e.VITE_USE_EMULATORS === 'true',
    },
  };
}
```

`frontend/src/lib/firebase.ts`:
```ts
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import type { Env } from './env';

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

/** Initializes Firebase once. Auth persistence is the SDK default (IndexedDB), so sessions survive reloads. */
export function initFirebase(env: Env): void {
  if (app) return;
  app = initializeApp(env.firebase);
  authInstance = getAuth(app);
  dbInstance = getFirestore(app);
  if (env.useEmulators) {
    connectAuthEmulator(authInstance, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(dbInstance, '127.0.0.1', 8080);
  }
}

export function auth(): Auth {
  if (!authInstance) throw new Error('Firebase is not initialized; call initFirebase() first.');
  return authInstance;
}

export function db(): Firestore {
  if (!dbInstance) throw new Error('Firebase is not initialized; call initFirebase() first.');
  return dbInstance;
}
```

`frontend/src/app/config-error.ts`:
```ts
/** Rendered without Vue when the env is invalid, so a misconfigured deploy never shows a blank page. */
export function renderConfigError(problems: readonly string[]): void {
  const root = document.getElementById('app');
  if (!root) return;
  const box = document.createElement('div');
  box.style.cssText =
    'font:14px/1.5 system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:24px';
  const title = document.createElement('h1');
  title.textContent = 'Genesis is not configured';
  title.style.cssText = 'font-size:18px;font-weight:600;margin:0 0 8px';
  const hint = document.createElement('p');
  hint.textContent =
    'Set these variables (see frontend/.env.example), then restart the dev server or rebuild:';
  const list = document.createElement('ul');
  for (const problem of problems) {
    const item = document.createElement('li');
    item.textContent = problem;
    list.append(item);
  }
  box.append(title, hint, list);
  root.replaceChildren(box);
}
```

- [ ] **Step 3: Env files.** Firebase web config and function URLs are public by design (they ship in the bundle), so `frontend/.env.production` is committed; nothing secret may ever be added to it. Add `!frontend/.env.production` under the `!.env.example` line in the root `.gitignore`.

`frontend/.env.example`:
```bash
# Public values only — everything here ships to every browser.
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=genesis-builder-7f3a.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=genesis-builder-7f3a
VITE_FIREBASE_APP_ID=
VITE_API_BASE_URL=https://us-central1-genesis-builder-7f3a.cloudfunctions.net/api
VITE_GENERATE_BASE_URL=https://us-central1-genesis-builder-7f3a.cloudfunctions.net/generate
VITE_USE_EMULATORS=false
```

`frontend/.env.production`: the same keys with the real values from `firebase apps:sdkconfig web` (prerequisites §3).

`frontend/.env.local` (local development against the emulators — `npm run emulators` at the root; `.env.production` still wins for `vite build` because mode files override `.env.local`):
```bash
VITE_FIREBASE_API_KEY=demo-api-key
VITE_FIREBASE_AUTH_DOMAIN=localhost
VITE_FIREBASE_PROJECT_ID=genesis-builder-7f3a
VITE_FIREBASE_APP_ID=1:1:web:1
VITE_API_BASE_URL=http://127.0.0.1:5001/genesis-builder-7f3a/us-central1/api
VITE_GENERATE_BASE_URL=http://127.0.0.1:5001/genesis-builder-7f3a/us-central1/generate
VITE_USE_EMULATORS=true
```

- [ ] **Step 4: Run** `npm test` → PASS. **Commit** — `feat(frontend): validate env and initialize Firebase with emulator support`

---

### Task FE-0.5: HTTP client and error mapping

**Files:**
- Create: `frontend/src/lib/http.ts`, `frontend/src/lib/errors.ts`, `frontend/src/lib/ids.ts`
- Test: `frontend/tests/lib/http.test.ts`, `frontend/tests/lib/errors.test.ts`

**Interfaces:**
- Produces: `ApiError { code: ClientErrorCode; status; retryable; details; requestId }`, `isApiError`, `ClientErrorCode = ErrorCode | 'NETWORK' | 'TIMEOUT' | 'ABORTED'`, `configureHttp({ baseUrls, getIdToken })`, `apiUrl(target, path, query?)`, `authorizedHeaders()`, `combineSignals(signals)`, `toTransportError(error, callerSignal?)`, `parseErrorResponse(res)`, `apiFetch<T>(target, path, { method, query, body, signal, timeoutMs })`; `toUserMessage(error)`, `messageForCode(code)`, `retryAfterSeconds(error)`, `errorCodeOf(error)`; `newId()`, `newNonce()`.

- [ ] **Step 1: Failing tests**

`frontend/tests/lib/http.test.ts`:
```ts
import { ApiError, apiFetch, apiUrl, configureHttp, isApiError } from '@/lib/http';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('http client', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    configureHttp({
      baseUrls: { api: 'https://fn.test/api', generate: 'https://fn.test/generate' },
      getIdToken: () => Promise.resolve('token-1'),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('builds URLs and drops empty query values', () => {
    expect(apiUrl('api', '/v1/x', { a: 1, b: undefined, c: null, d: 'y' })).toBe(
      'https://fn.test/api/v1/x?a=1&d=y',
    );
  });

  it('sends the ID token and returns data', async () => {
    fetchMock.mockResolvedValue(json(200, { data: { ok: true } }));
    await expect(
      apiFetch('api', '/v1/health', { method: 'POST', body: { a: 1 } }),
    ).resolves.toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer token-1');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init?.body).toBe('{"a":1}');
  });

  it('maps the error envelope to ApiError', async () => {
    fetchMock.mockResolvedValue(
      json(409, {
        error: {
          code: 'FILE_VERSION_CONFLICT',
          message: 'Changed',
          retryable: false,
          details: { currentVersion: 3 },
          requestId: 'r1',
        },
      }),
    );
    const error = await apiFetch('api', '/v1/x').catch((e: unknown) => e);
    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'FILE_VERSION_CONFLICT',
      status: 409,
      details: { currentVersion: 3 },
      requestId: 'r1',
    });
  });

  it('turns non-envelope failures into INTERNAL and network failures into NETWORK', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 502 }));
    await expect(apiFetch('api', '/v1/x')).rejects.toMatchObject({
      code: 'INTERNAL',
      retryable: true,
    });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(apiFetch('api', '/v1/x')).rejects.toMatchObject({
      code: 'NETWORK',
      retryable: true,
    });
  });

  it('refuses to call without a session', async () => {
    configureHttp({
      baseUrls: { api: 'https://fn.test/api', generate: '' },
      getIdToken: () => Promise.resolve(null),
    });
    await expect(apiFetch('api', '/v1/x')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

`frontend/tests/lib/errors.test.ts`:
```ts
import { FirebaseError } from 'firebase/app';
import { retryAfterSeconds, toUserMessage } from '@/lib/errors';
import { ApiError } from '@/lib/http';

describe('error mapping', () => {
  it('prefers the server message, then the catalog, never raw errors', () => {
    expect(
      toUserMessage(
        new ApiError({ code: 'RATE_LIMITED', message: '', status: 429, retryable: true }),
      ),
    ).toMatch(/Too many requests/);
    expect(
      toUserMessage(
        new ApiError({
          code: 'HL_BAD_REQUEST',
          message: 'Email is invalid',
          status: 422,
          retryable: false,
        }),
      ),
    ).toBe('Email is invalid');
    expect(toUserMessage(new FirebaseError('permission-denied', 'raw'))).toBe(
      "You don't have access to this.",
    );
    expect(toUserMessage(new Error('stack trace…'))).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('reads Retry-After from details', () => {
    const e = new ApiError({
      code: 'RATE_LIMITED',
      message: 'x',
      status: 429,
      retryable: true,
      details: { retryAfterMs: 2_500 },
    });
    expect(retryAfterSeconds(e)).toBe(3);
    expect(retryAfterSeconds(new Error('x'))).toBeNull();
  });
});
```

- [ ] **Step 2: Implement** (`http.ts` has no Firebase import: `main.ts` injects the token provider, which keeps it testable)

`frontend/src/lib/http.ts`:
```ts
import { ApiErrorBodySchema, defaultMessage, type ErrorCode } from '@/contracts/errors';

export type ApiTarget = 'api' | 'generate';
/** Server codes plus client-only transport failures. */
export type ClientErrorCode = ErrorCode | 'NETWORK' | 'TIMEOUT' | 'ABORTED';

export interface ApiErrorInit {
  code: ClientErrorCode;
  message: string;
  status: number;
  retryable: boolean;
  details?: Record<string, unknown> | undefined;
  requestId?: string | null;
}

export class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>>;
  readonly requestId: string | null;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.retryable = init.retryable;
    this.details = init.details ?? {};
    this.requestId = init.requestId ?? null;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

export interface HttpConfig {
  baseUrls: Readonly<Record<ApiTarget, string>>;
  getIdToken: () => Promise<string | null>;
}

let config: HttpConfig | null = null;

/** Called once from main.ts (and from tests) — keeps this module free of Firebase imports. */
export function configureHttp(next: HttpConfig): void {
  config = next;
}

function currentConfig(): HttpConfig {
  if (!config) throw new Error('HTTP client is not configured; call configureHttp() first.');
  return config;
}

export type QueryParams = Readonly<Record<string, string | number | boolean | null | undefined>>;

export function apiUrl(target: ApiTarget, path: string, query?: QueryParams): string {
  const url = new URL(currentConfig().baseUrls[target] + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function authorizedHeaders(): Promise<Record<string, string>> {
  const token = await currentConfig().getIdToken();
  if (!token) {
    throw new ApiError({
      code: 'UNAUTHENTICATED',
      message: defaultMessage('UNAUTHENTICATED'),
      status: 401,
      retryable: false,
    });
  }
  return { Authorization: `Bearer ${token}`, 'X-Request-Id': crypto.randomUUID() };
}

/** AbortSignal.any() without requiring the newest browsers. */
export function combineSignals(signals: readonly (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

export function toTransportError(error: unknown, callerSignal?: AbortSignal): ApiError {
  if (isApiError(error)) return error;
  if (callerSignal?.aborted) {
    return new ApiError({
      code: 'ABORTED',
      message: 'Request cancelled.',
      status: 0,
      retryable: false,
    });
  }
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  if (name === 'TimeoutError') {
    return new ApiError({
      code: 'TIMEOUT',
      message: 'The request took too long. Please try again.',
      status: 0,
      retryable: true,
    });
  }
  return new ApiError({
    code: 'NETWORK',
    message: 'Network error — check your connection.',
    status: 0,
    retryable: true,
  });
}

export async function parseErrorResponse(res: Response): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null);
  const parsed = ApiErrorBodySchema.safeParse(body);
  if (parsed.success) {
    const e = parsed.data.error;
    return new ApiError({
      code: e.code,
      message: e.message,
      status: res.status,
      retryable: e.retryable,
      details: e.details,
      requestId: e.requestId,
    });
  }
  return new ApiError({
    code: 'INTERNAL',
    message: defaultMessage('INTERNAL'),
    status: res.status,
    retryable: res.status >= 500 || res.status === 429,
    requestId: res.headers.get('x-request-id'),
  });
}

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** JSON request against the `api`/`generate` functions; resolves `data`, throws `ApiError`. */
export async function apiFetch<T>(
  target: ApiTarget,
  path: string,
  req: ApiRequest = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(await authorizedHeaders()),
    Accept: 'application/json',
  };
  if (req.body !== undefined) headers['Content-Type'] = 'application/json';
  const signal = combineSignals([
    req.signal,
    AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  ]);

  let res: Response;
  try {
    res = await fetch(apiUrl(target, path, req.query), {
      method: req.method ?? 'GET',
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    throw toTransportError(error, req.signal);
  }
  if (!res.ok) throw await parseErrorResponse(res);

  const json: unknown = await res.json().catch(() => null);
  if (json === null || typeof json !== 'object' || !('data' in json)) {
    throw new ApiError({
      code: 'INTERNAL',
      message: defaultMessage('INTERNAL'),
      status: res.status,
      retryable: true,
      requestId: res.headers.get('x-request-id'),
    });
  }
  return (json as { data: T }).data;
}
```

`frontend/src/lib/errors.ts`:
```ts
import { FirebaseError } from 'firebase/app';
import { ERROR_CATALOG, type ErrorCode } from '@/contracts/errors';
import { isApiError } from './http';

const GENERIC = 'Something went wrong. Please try again.';

const FIRESTORE_MESSAGES: Readonly<Record<string, string>> = {
  'permission-denied': "You don't have access to this.",
  unavailable: "Can't reach the database — check your connection.",
  'deadline-exceeded': 'The request took too long. Please try again.',
  'not-found': 'Not found.',
};

export function messageForCode(code: string): string {
  return code in ERROR_CATALOG ? ERROR_CATALOG[code as ErrorCode].message : GENERIC;
}

/** The only way UI code turns an error into text. Never exposes stacks or raw bodies. */
export function toUserMessage(error: unknown): string {
  if (isApiError(error)) return error.message.trim() || messageForCode(error.code);
  if (error instanceof FirebaseError) {
    const code = error.code.replace(/^firestore\//, '');
    return FIRESTORE_MESSAGES[code] ?? GENERIC;
  }
  return GENERIC;
}

export function retryAfterSeconds(error: unknown): number | null {
  if (!isApiError(error)) return null;
  const ms = error.details['retryAfterMs'];
  return typeof ms === 'number' && ms > 0 ? Math.ceil(ms / 1000) : null;
}

export function errorCodeOf(error: unknown): string | null {
  if (isApiError(error)) return error.code;
  if (error instanceof FirebaseError) return error.code;
  return null;
}
```

`frontend/src/lib/ids.ts`:
```ts
export const newId = (): string => crypto.randomUUID();

/** 128-bit hex nonce for preview renders (bridge handshake). */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 3: Run** `npm test` → PASS. **Commit** — `feat(frontend): add typed HTTP client and user-facing error mapping`

---

### Task FE-0.6: Router, guards, layouts and the app shell

**Files:**
- Create: `frontend/src/app/guards.ts`, `frontend/src/app/router.ts`, `frontend/src/app/App.vue`, `frontend/src/app/NotFoundPage.vue`, `frontend/src/app/layouts/AuthLayout.vue`, `frontend/src/app/layouts/AppLayout.vue`, `frontend/src/components/common/PageState.vue`, `RelativeTime.vue`, `OfflineBanner.vue`, `ThemeToggle.vue`, `ConfirmDialog.vue`, `frontend/src/composables/useTheme.ts`, `useConfirm.ts`, `frontend/src/main.ts` (replace)
- Test: `frontend/tests/app/guards.test.ts`

**Interfaces:**
- Produces: `resolveNavigation(input)`, `routes`, `createAppRouter()`, `installAuthRedirect(router)`, route names `root | sign-in | sign-up | dashboard | workspace | not-found`, `RouteMeta { requiresAuth?, guestOnly?, layout?: 'auth' | 'app' | 'bare', title? }`; `useTheme() → { mode, resolved, setMode }`, `isThemeMode`; `confirmAction(options): Promise<boolean>`, `useConfirm()`; `<PageState kind title description actionLabel actionTo @action>`, `<RelativeTime :ms>`.
- Consumes: `useAuth`/`startAuthListener` (FE-1.1), `AppHeader` (FE-1.4/FE-2.2) and the page components (FE-1.3, FE-2.4, FE-3.1). Until those tasks land, create each page as a one-line placeholder (`<template><PageState kind="loading" /></template>`) so the router compiles; the tasks overwrite them.

- [ ] **Step 1: Failing test**

`frontend/tests/app/guards.test.ts`:
```ts
import { resolveNavigation } from '@/app/guards';

describe('resolveNavigation', () => {
  const base = { requiresAuth: false, guestOnly: false, signedIn: false, fullPath: '/projects/p1' };
  it('sends signed-out users to sign-in with a redirect back', () => {
    expect(resolveNavigation({ ...base, requiresAuth: true })).toEqual({
      name: 'sign-in',
      query: { redirect: '/projects/p1' },
    });
  });
  it('keeps signed-in users away from auth pages', () => {
    expect(resolveNavigation({ ...base, guestOnly: true, signedIn: true })).toEqual({
      name: 'dashboard',
    });
  });
  it('allows everything else', () => {
    expect(resolveNavigation({ ...base, requiresAuth: true, signedIn: true })).toBe(true);
    expect(resolveNavigation(base)).toBe(true);
  });
});
```

- [ ] **Step 2: Routing**

`frontend/src/app/guards.ts`:
```ts
import type { RouteLocationRaw } from 'vue-router';

export interface NavigationInput {
  requiresAuth: boolean;
  guestOnly: boolean;
  signedIn: boolean;
  fullPath: string;
}

/** Pure routing decision (tested without a router). */
export function resolveNavigation(input: NavigationInput): true | RouteLocationRaw {
  if (input.requiresAuth && !input.signedIn) {
    return { name: 'sign-in', query: { redirect: input.fullPath } };
  }
  if (input.guestOnly && input.signedIn) return { name: 'dashboard' };
  return true;
}
```

`frontend/src/app/router.ts`:
```ts
import { onAuthStateChanged } from 'firebase/auth';
import { createRouter, createWebHistory, type RouteRecordRaw, type Router } from 'vue-router';
import { auth } from '@/lib/firebase';
import { resolveNavigation } from './guards';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    guestOnly?: boolean;
    layout?: 'auth' | 'app' | 'bare';
    title?: string;
  }
}

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'root', redirect: { name: 'dashboard' } },
  {
    path: '/sign-in',
    name: 'sign-in',
    component: () => import('@/features/auth/SignInPage.vue'),
    meta: { guestOnly: true, layout: 'auth', title: 'Sign in' },
  },
  {
    path: '/sign-up',
    name: 'sign-up',
    component: () => import('@/features/auth/SignUpPage.vue'),
    meta: { guestOnly: true, layout: 'auth', title: 'Create account' },
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/features/projects/DashboardPage.vue'),
    meta: { requiresAuth: true, layout: 'app', title: 'Projects' },
  },
  {
    path: '/projects/:projectId',
    name: 'workspace',
    component: () => import('@/features/workspace/WorkspacePage.vue'),
    props: true,
    meta: { requiresAuth: true, layout: 'bare', title: 'Workspace' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('./NotFoundPage.vue'),
    meta: { layout: 'app', title: 'Not found' },
  },
];

export function createAppRouter(): Router {
  const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
    scrollBehavior: () => ({ top: 0 }),
  });

  router.beforeEach(async (to) => {
    await auth().authStateReady();
    return resolveNavigation({
      requiresAuth: to.meta.requiresAuth === true,
      guestOnly: to.meta.guestOnly === true,
      signedIn: auth().currentUser !== null,
      fullPath: to.fullPath,
    });
  });

  router.afterEach((to) => {
    document.title = to.meta.title ? `${to.meta.title} · Genesis` : 'Genesis';
  });

  return router;
}

/** When the session ends (sign-out elsewhere, token revoked), leave protected pages. */
export function installAuthRedirect(router: Router): void {
  onAuthStateChanged(auth(), (user) => {
    if (!user && router.currentRoute.value.meta.requiresAuth) {
      void router.replace({ name: 'sign-in' });
    }
  });
}
```

Layouts come from `meta.layout` (not nested layout routes) so every URL maps to exactly one record. The workspace uses the `bare` layout and is keyed by path, so switching projects remounts it with fresh state.

- [ ] **Step 3: Shell, layouts and common components**

`frontend/src/app/App.vue`:
```vue
<script setup lang="ts">
import { RouterView } from 'vue-router';
import ConfirmDialog from '@/components/common/ConfirmDialog.vue';
import OfflineBanner from '@/components/common/OfflineBanner.vue';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useTheme } from '@/composables/useTheme';
import AppLayout from './layouts/AppLayout.vue';
import AuthLayout from './layouts/AuthLayout.vue';

const { resolved } = useTheme();
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <OfflineBanner />
    <RouterView v-slot="{ Component, route }">
      <AuthLayout v-if="route.meta.layout === 'auth'">
        <component :is="Component" />
      </AuthLayout>
      <AppLayout v-else-if="route.meta.layout === 'app'">
        <component :is="Component" />
      </AppLayout>
      <!-- Keyed by path: switching projects remounts the workspace with fresh state. -->
      <component :is="Component" v-else :key="route.path" />
    </RouterView>
    <ConfirmDialog />
    <Toaster :theme="resolved" position="bottom-right" close-button />
  </TooltipProvider>
</template>
```

`frontend/src/app/layouts/AuthLayout.vue`:
```vue
<script setup lang="ts">
import ThemeToggle from '@/components/common/ThemeToggle.vue';
</script>

<template>
  <div
    class="relative flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12"
  >
    <div class="absolute top-4 right-4">
      <ThemeToggle />
    </div>
    <div class="w-full max-w-sm">
      <p class="mb-8 text-center text-sm font-semibold tracking-tight">Genesis</p>
      <slot />
    </div>
  </div>
</template>
```

`frontend/src/app/layouts/AppLayout.vue`:
```vue
<script setup lang="ts">
import AppHeader from '@/components/common/AppHeader.vue';
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-background">
    <AppHeader />
    <main class="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6">
      <slot />
    </main>
  </div>
</template>
```

`frontend/src/app/NotFoundPage.vue`:
```vue
<script setup lang="ts">
import PageState from '@/components/common/PageState.vue';
</script>

<template>
  <PageState
    kind="empty"
    title="Page not found"
    description="The page you're looking for doesn't exist."
    action-label="Go to projects"
    :action-to="{ name: 'dashboard' }"
  />
</template>
```

`frontend/src/components/common/PageState.vue`:
```vue
<script setup lang="ts">
import { CircleAlertIcon } from '@lucide/vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';

const props = defineProps<{
  kind: 'loading' | 'empty' | 'error';
  title?: string;
  description?: string;
  actionLabel?: string;
  actionTo?: RouteLocationRaw;
}>();

const emit = defineEmits<{ action: [] }>();
</script>

<template>
  <div
    v-if="props.kind === 'loading'"
    class="flex min-h-40 flex-1 items-center justify-center"
    role="status"
    aria-live="polite"
  >
    <Spinner class="size-5 text-muted-foreground" />
    <span class="sr-only">{{ props.title ?? 'Loading' }}</span>
  </div>
  <Empty v-else class="min-h-40 flex-1">
    <EmptyHeader>
      <EmptyMedia v-if="props.kind === 'error'" variant="icon">
        <CircleAlertIcon />
      </EmptyMedia>
      <EmptyTitle>{{ props.title }}</EmptyTitle>
      <EmptyDescription v-if="props.description">{{ props.description }}</EmptyDescription>
    </EmptyHeader>
    <EmptyContent v-if="props.actionLabel">
      <Button v-if="props.actionTo" as-child variant="outline" size="sm">
        <RouterLink :to="props.actionTo">{{ props.actionLabel }}</RouterLink>
      </Button>
      <Button v-else variant="outline" size="sm" @click="emit('action')">
        {{ props.actionLabel }}
      </Button>
    </EmptyContent>
  </Empty>
</template>
```

`frontend/src/components/common/RelativeTime.vue`:
```vue
<script setup lang="ts">
import { useIntervalFn, useNow } from '@vueuse/core';
import { computed } from 'vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatAbsolute, formatRelative } from '@/lib/time';

const props = defineProps<{ ms: number | null }>();

const now = useNow({ scheduler: (tick) => useIntervalFn(tick, 30_000) });
const relative = computed(() =>
  props.ms === null ? '—' : formatRelative(props.ms, now.value.getTime()),
);
const absolute = computed(() => (props.ms === null ? '' : formatAbsolute(props.ms)));
const iso = computed(() => (props.ms === null ? undefined : new Date(props.ms).toISOString()));
</script>

<template>
  <Tooltip v-if="props.ms !== null">
    <TooltipTrigger as-child>
      <time :datetime="iso" class="tabular-nums">{{ relative }}</time>
    </TooltipTrigger>
    <TooltipContent>{{ absolute }}</TooltipContent>
  </Tooltip>
  <span v-else>—</span>
</template>
```

`frontend/src/components/common/OfflineBanner.vue`:
```vue
<script setup lang="ts">
import { WifiOffIcon } from '@lucide/vue';
import { useOnline } from '@vueuse/core';

const online = useOnline();
</script>

<template>
  <div
    v-if="!online"
    role="status"
    class="flex items-center justify-center gap-2 border-b bg-muted px-4 py-1.5 text-xs text-muted-foreground"
  >
    <WifiOffIcon class="size-3.5" aria-hidden="true" />
    You're offline. Saving and generating are paused until the connection returns.
  </div>
</template>
```

`frontend/src/components/common/ThemeToggle.vue`:
```vue
<script setup lang="ts">
import { MonitorIcon, MoonIcon, SunIcon } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { isThemeMode, useTheme } from '@/composables/useTheme';

const { mode, resolved, setMode } = useTheme();

function onSelect(value: unknown): void {
  if (isThemeMode(value)) setMode(value);
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon-sm" aria-label="Theme">
        <MoonIcon v-if="resolved === 'dark'" />
        <SunIcon v-else />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuRadioGroup :model-value="mode" @update:model-value="onSelect">
        <DropdownMenuRadioItem value="light"><SunIcon />Light</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="dark"><MoonIcon />Dark</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="auto"><MonitorIcon />System</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
```

`frontend/src/components/common/ConfirmDialog.vue`:
```vue
<script setup lang="ts">
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/composables/useConfirm';

const { state, settle } = useConfirm();

function onOpenChange(open: boolean): void {
  if (!open) settle(false);
}
</script>

<template>
  <AlertDialog :open="state.open" @update:open="onOpenChange">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ state.title }}</AlertDialogTitle>
        <AlertDialogDescription :class="{ 'sr-only': !state.description }">
          {{ state.description || state.title }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ state.cancelLabel }}</AlertDialogCancel>
        <Button :variant="state.destructive ? 'destructive' : 'default'" @click="settle(true)">
          {{ state.confirmLabel }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
```

`frontend/src/composables/useTheme.ts`:
```ts
import { createSharedComposable, useColorMode } from '@vueuse/core';
import { computed, type ComputedRef, type Ref } from 'vue';

export type ThemeMode = 'light' | 'dark' | 'auto';

export const isThemeMode = (value: unknown): value is ThemeMode =>
  value === 'light' || value === 'dark' || value === 'auto';

export interface ThemeApi {
  /** What the user chose (including "auto"). */
  mode: Ref<ThemeMode>;
  /** What is actually applied. */
  resolved: ComputedRef<'light' | 'dark'>;
  setMode: (mode: ThemeMode) => void;
}

function createTheme(): ThemeApi {
  // Same storage key as the pre-paint script in index.html.
  const colorMode = useColorMode({ storageKey: 'genesis-color-scheme', disableTransition: true });
  return {
    mode: colorMode.store,
    resolved: computed(() => colorMode.state.value),
    setMode: (mode) => {
      colorMode.store.value = mode;
    },
  };
}

export const useTheme = createSharedComposable(createTheme);
```

`frontend/src/composables/useConfirm.ts`:
```ts
import { reactive, readonly } from 'vue';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmState {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive: boolean;
}

const state = reactive<ConfirmState>({
  open: false,
  title: '',
  description: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  destructive: false,
});
let resolver: ((ok: boolean) => void) | null = null;

/** Promise-based confirmation rendered by the single <ConfirmDialog> in App.vue. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  resolver?.(false); // a newer request replaces an unanswered one
  Object.assign(state, {
    open: true,
    title: options.title,
    description: options.description ?? '',
    confirmLabel: options.confirmLabel ?? 'Confirm',
    cancelLabel: options.cancelLabel ?? 'Cancel',
    destructive: options.destructive ?? false,
  });
  return new Promise((resolve) => {
    resolver = resolve;
  });
}

export function settleConfirm(ok: boolean): void {
  state.open = false;
  const resolve = resolver;
  resolver = null;
  resolve?.(ok);
}

export function useConfirm() {
  return { state: readonly(state), confirm: confirmAction, settle: settleConfirm };
}
```

- [ ] **Step 4: Entry point** (final form; `startAuthListener` arrives in FE-1.1 — add that import when you get there)

`frontend/src/main.ts`:
```ts
import '@fontsource-variable/inter';
import 'vue-sonner/style.css';
import '@/assets/main.css';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import { toast } from 'vue-sonner';
import App from '@/app/App.vue';
import { renderConfigError } from '@/app/config-error';
import { createAppRouter, installAuthRedirect } from '@/app/router';
import { startAuthListener } from '@/composables/useAuth';
import { parseEnv } from '@/lib/env';
import { auth, initFirebase } from '@/lib/firebase';
import { configureHttp } from '@/lib/http';

const result = parseEnv({ ...import.meta.env });

if (!result.ok) {
  renderConfigError(result.problems);
} else {
  const { env } = result;
  initFirebase(env);
  configureHttp({
    baseUrls: { api: env.apiBaseUrl, generate: env.generateBaseUrl },
    getIdToken: async () => (await auth().currentUser?.getIdToken()) ?? null,
  });
  startAuthListener();

  const app = createApp(App);
  const router = createAppRouter();
  app.use(createPinia());
  app.use(router);
  installAuthRedirect(router);
  app.config.errorHandler = (error, _instance, info) => {
    console.error('[genesis] unhandled error in', info, error);
    toast.error('Something went wrong. Please try again.');
  };
  app.mount('#app');
}
```

- [ ] **Step 5: Verify** — `npm test`, `npm run typecheck`, `npm run lint` clean; `npm run dev`: `/dashboard` while signed out redirects to `/sign-in?redirect=/dashboard`; `/nope` shows "Page not found"; the theme menu switches light/dark without a flash on reload.

- [ ] **Step 6: Commit** — `feat(frontend): add router, auth guards, layouts and app shell`
