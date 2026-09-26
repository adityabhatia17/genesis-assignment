# BE-0 — Foundation

> Read [`00-overview.md`](00-overview.md) (Global Constraints, Coding Standards) before starting. All paths are relative to the repo root `genesis/` unless stated.

**Outcome of this phase:** a git repo with Firebase config; a `functions/` package that builds, lints and tests; the error catalog and shared kernel; typed runtime config; an Express app factory with request context, CORS, auth, validation, error envelope and a Firestore-backed rate limiter; `api` and `generate` deployed on Node 24 with health endpoints; a verified SSE stream from production.

---

### Task BE-0.1: Root scaffold and Firebase configuration

**Files:**
- Create: `.gitignore`, `.editorconfig`, `.nvmrc`, `.prettierrc.json`, `package.json`, `LICENSE`, `README.md` (stub), `firebase.json`, `.firebaserc`, `firestore.rules` (temporary deny-all), `firestore.indexes.json`, `.env.example`, `.github/workflows/ci.yml` (content in `10-delivery-git-and-deployment.md` §4.1)

**Interfaces:** Produces root scripts (`contracts:sync`, `contracts:check`, `test:rules`, `test:integration`, `emulators`, `deploy`) used by later tasks and CI.

- [ ] **Step 1: Initialize git on `main`**

```bash
cd /Users/mac/Developer/genesis
git init -b main
```

- [ ] **Step 2: Create `.gitignore`**

```gitignore
# dependencies / builds
node_modules/
dist/
lib/
coverage/
.vite/

# firebase
.firebase/
*-debug.log*
.emulator-data/

# env & secrets (only *.example files are committed)
.env
.env.*
!.env.example
*.local
.secret.local
!.secret.local.example
service-account*.json
*-credentials.json
spike-tokens.json

# os / editors
.DS_Store
.idea/
.vscode/*
!.vscode/extensions.json

# recorded fixtures before scrubbing
functions/test/fixtures/hl/raw/
```

- [ ] **Step 3: Create `.editorconfig`, `.nvmrc`, `.prettierrc.json`**

`.editorconfig`:
```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

`.nvmrc`:
```
24
```

`.prettierrc.json`:
```json
{
  "singleQuote": true,
  "semi": true,
  "printWidth": 100,
  "trailingComma": "all",
  "arrowParens": "always"
}
```

- [ ] **Step 4: Create root `package.json` (scripts only, no workspaces)**

```json
{
  "name": "genesis",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "contracts:sync": "node scripts/sync-contracts.mjs",
    "contracts:check": "node scripts/sync-contracts.mjs --check",
    "install:all": "npm ci --prefix functions && npm ci --prefix frontend",
    "lint": "npm --prefix functions run lint && npm --prefix frontend run lint",
    "typecheck": "npm --prefix functions run typecheck && npm --prefix frontend run typecheck",
    "test": "npm --prefix functions test && npm --prefix frontend test",
    "test:rules": "firebase emulators:exec --project demo-genesis --only firestore \"npm --prefix functions run test:rules\"",
    "test:integration": "firebase emulators:exec --project demo-genesis --only auth,firestore \"npm --prefix functions run test:integration\"",
    "build": "npm --prefix functions run build && npm --prefix frontend run build",
    "emulators": "firebase emulators:start --import ./.emulator-data --export-on-exit",
    "deploy": "firebase deploy --only functions,hosting,firestore"
  }
}
```

- [ ] **Step 5: Create `firebase.json`**

```json
{
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "runtime": "nodejs24",
      "ignore": [
        "node_modules",
        ".git",
        "*.log",
        "*.local",
        ".env.example",
        ".secret.local.example",
        "src",
        "test",
        "evals",
        "scripts",
        "coverage"
      ],
      "predeploy": [
        "npm --prefix \"$RESOURCE_DIR\" run lint",
        "npm --prefix \"$RESOURCE_DIR\" run build"
      ]
    }
  ],
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "hosting": {
    "public": "frontend/dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "predeploy": ["npm --prefix frontend run build"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }],
    "headers": [
      {
        "source": "**",
        "headers": [
          { "key": "X-Content-Type-Options", "value": "nosniff" },
          { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
          { "key": "X-Frame-Options", "value": "DENY" },
          { "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains" },
          { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), payment=()" }
        ]
      },
      {
        "source": "/assets/**",
        "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
      },
      {
        "source": "/index.html",
        "headers": [{ "key": "Cache-Control", "value": "no-cache" }]
      }
    ]
  },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "functions": { "port": 5001 },
    "hosting": { "port": 5000 },
    "ui": { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
}
```

> No `Content-Security-Policy` header on purpose: the preview iframe (`srcdoc`) inherits the SPA's policy, and a strict `script-src` would block the preview's inline scripts (`research/05` §5).

- [ ] **Step 6: Create `.firebaserc`** (replace the ID with yours from `03-prerequisites.md` §3.1)

```json
{
  "projects": {
    "default": "genesis-builder-7f3a"
  }
}
```

- [ ] **Step 7: Create temporary `firestore.rules` (deny all; BE-2.1 replaces it) and `firestore.indexes.json`**

`firestore.rules`:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

`firestore.indexes.json`:
```json
{
  "indexes": [
    {
      "collectionGroup": "projects",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

- [ ] **Step 8: Create root `.env.example` (documents every variable)**

```bash
# ─────────────────────────────────────────────────────────────────────────────
# Genesis — every configuration variable, grouped by where it is used.
# Copy the relevant block into the file named in each header. Never commit real values.
# ─────────────────────────────────────────────────────────────────────────────

# ── frontend/.env.local (dev) · frontend/.env.production (build) ─────────────
# Firebase web config is public by design; `firebase apps:sdkconfig web` prints it.
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=genesis-builder-7f3a.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=genesis-builder-7f3a
VITE_FIREBASE_APP_ID=
VITE_API_BASE_URL=https://us-central1-genesis-builder-7f3a.cloudfunctions.net/api
VITE_GENERATE_BASE_URL=https://us-central1-genesis-builder-7f3a.cloudfunctions.net/generate
VITE_USE_EMULATORS=false

# ── functions/.env.<projectId> (deploy) · functions/.env.local (emulators) ───
APP_BASE_URL=https://genesis-builder-7f3a.web.app
ALLOWED_ORIGINS=https://genesis-builder-7f3a.web.app,https://genesis-builder-7f3a.firebaseapp.com,http://localhost:5173,http://127.0.0.1:5173
HL_REDIRECT_URI=https://us-central1-genesis-builder-7f3a.cloudfunctions.net/api/v1/hl/oauth/callback
HL_SCOPES="contacts.readonly conversations.readonly conversations/message.readonly calendars.readonly calendars/events.readonly locations.readonly"
HL_API_BASE_URL=https://services.leadconnectorhq.com
HL_AUTHORIZE_URL=https://marketplace.gohighlevel.com/v2/oauth/chooselocation
ANTHROPIC_MODEL=claude-opus-5
ANTHROPIC_EFFORT=medium
LLM_PROVIDER=anthropic
API_MIN_INSTANCES=0
GENERATE_MIN_INSTANCES=0
SSE_SMOKE_ENABLED=false

# ── Secrets: Secret Manager in prod (`firebase functions:secrets:set NAME`) ───
# ── functions/.secret.local for the emulator ─────────────────────────────────
ANTHROPIC_API_KEY=
HL_CLIENT_ID=
HL_CLIENT_SECRET=
TOKEN_ENCRYPTION_KEY=          # openssl rand -base64 32

# ── Local-only scripts (never deployed) ─────────────────────────────────────
HL_PIT=                        # sub-account Private Integration Token for scripts/seed-pit-connection.ts
```

- [ ] **Step 9: Create `LICENSE` (MIT) and `README.md` stub**

`LICENSE`: standard MIT text, `Copyright (c) 2026 <Your Name>`.

`README.md`:
```markdown
# Genesis — AI-powered HighLevel app builder

Work in progress. See `docs/01-analysis-and-proposal.md`. The full README is written on Day 5 (`docs/10-delivery-git-and-deployment.md` §7).
```

- [ ] **Step 10: Add CI workflow** — create `.github/workflows/ci.yml` with the exact content of `10-delivery-git-and-deployment.md` §4.1 (jobs skip folders that don't exist yet).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore(repo): scaffold repository, firebase config and env documentation"
```

---

### Task BE-0.2: Functions package and tooling

**Files:**
- Create: `functions/package.json`, `functions/tsconfig.json`, `functions/tsconfig.test.json`, `functions/eslint.config.js`, `functions/vitest.config.ts`, `functions/vitest.integration.config.ts`, `functions/.env.example`, `functions/.secret.local.example`, `functions/src/index.ts` (placeholder), `functions/test/unit/smoke.test.ts`

**Interfaces:** Produces npm scripts `build`, `lint`, `typecheck`, `test`, `test:integration`, `test:rules`, `seed:pit`, `spike:oauth`, `record:fixtures`.

- [ ] **Step 1: Create `functions/package.json`**

```json
{
  "name": "genesis-functions",
  "private": true,
  "type": "module",
  "main": "lib/index.js",
  "engines": { "node": "24" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "build:watch": "tsc -p tsconfig.json --watch",
    "clean": "rm -rf lib",
    "lint": "eslint .",
    "typecheck": "tsc -p tsconfig.test.json --noEmit",
    "test": "vitest run --config vitest.config.ts",
    "test:watch": "vitest --config vitest.config.ts",
    "test:integration": "vitest run --config vitest.integration.config.ts test/integration",
    "test:rules": "vitest run --config vitest.integration.config.ts test/rules",
    "seed:pit": "tsx scripts/seed-pit-connection.ts",
    "spike:oauth": "tsx scripts/spike-oauth.ts",
    "record:fixtures": "tsx scripts/record-hl-fixtures.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "0.128.0",
    "acorn": "^8.18.0",
    "cors": "^2.8.6",
    "express": "^5.2.1",
    "firebase-admin": "^14.5.0",
    "firebase-functions": "^7.4.0",
    "parse5": "^8.0.1",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@firebase/rules-unit-testing": "^5.0.2",
    "@types/cors": "^2.8.19",
    "@types/express": "^5.0.6",
    "@types/node": "^24.13.6",
    "@types/supertest": "^7.2.1",
    "@vitest/coverage-v8": "^5.0.2",
    "eslint": "^10.11.0",
    "eslint-config-prettier": "^10.1.8",
    "firebase": "^12.19.0",
    "globals": "^17.12.0",
    "prettier": "^3.9.9",
    "supertest": "^7.3.0",
    "tsx": "^4.23.15",
    "typescript": "~5.9.3",
    "typescript-eslint": "^8.70.1",
    "vitest": "^5.0.2"
  }
}
```

- [ ] **Step 2: Create `functions/tsconfig.json` and `functions/tsconfig.test.json`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "lib",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

`tsconfig.test.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": ".",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "test", "evals", "scripts", "vitest.config.ts", "vitest.integration.config.ts"]
}
```

- [ ] **Step 3: Create `functions/eslint.config.js`**

```js
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  { ignores: ['lib/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-console': 'error',
    },
  },
  {
    files: ['test/**', 'scripts/**', 'evals/**'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-non-null-assertion': 'off', '@typescript-eslint/unbound-method': 'off' },
  },
  { files: ['**/*.js', '**/*.mjs'], ...tseslint.configs.disableTypeChecked },
  prettier,
]);
```

- [ ] **Step 4: Create Vitest configs**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    globals: true,
    clearMocks: true,
    restoreMocks: true,
    coverage: { provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/index.ts', 'src/composition.ts'] },
  },
});
```

`vitest.integration.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts', 'test/rules/**/*.test.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    setupFiles: ['test/helpers/integration-setup.ts'],
  },
});
```

- [ ] **Step 5: Create `functions/.env.example` and `functions/.secret.local.example`** — copy the "functions/.env" and "Secrets" blocks from the root `.env.example` (Step 8 of BE-0.1). Then create your local (git-ignored) `functions/.env.local`:

```bash
APP_BASE_URL=http://localhost:5173
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
HL_REDIRECT_URI=http://127.0.0.1:5001/genesis-builder-7f3a/us-central1/api/v1/hl/oauth/callback
LLM_PROVIDER=fake
SSE_SMOKE_ENABLED=true
```

and `functions/.secret.local` with your four secret values (fake values are fine until BE-3).

- [ ] **Step 6: Placeholder entry and smoke test**

`functions/src/index.ts`:
```ts
export {};
```

`functions/test/unit/smoke.test.ts`:
```ts
describe('toolchain', () => {
  it('runs vitest with TypeScript', () => {
    const sum: number = [1, 2, 3].reduce((a, b) => a + b, 0);
    expect(sum).toBe(6);
  });
});
```

`functions/test/helpers/integration-setup.ts`:
```ts
// Emulator hosts are injected by `firebase emulators:exec`; fail fast if missing.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST is not set — run via `npm run test:integration` from the repo root');
}
process.env.GCLOUD_PROJECT ??= 'demo-genesis';
```

- [ ] **Step 7: Install and verify**

```bash
cd functions
npm install
npm run build && npm run lint && npm run typecheck && npm test
```
Expected: `tsc` exits 0; ESLint prints nothing; Vitest reports `1 passed`.

- [ ] **Step 8: Commit**

```bash
git add functions/package.json functions/package-lock.json functions/tsconfig*.json functions/eslint.config.js functions/vitest*.ts functions/.env.example functions/.secret.local.example functions/src functions/test
git commit -m "chore(functions): add TypeScript, ESLint and Vitest tooling on Node 24"
```

---

### Task BE-0.3: Error catalog contract and shared kernel

**Files:**
- Create: `functions/src/contracts/errors.ts`, `functions/src/shared/app-error.ts`, `functions/src/shared/logger.ts`, `functions/src/shared/hash.ts`, `functions/src/shared/clock.ts`, `functions/src/shared/async.ts`, `functions/src/shared/firebase-admin.ts`, `functions/src/shared/firestore-paths.ts`
- Test: `functions/test/unit/contracts/errors.test.ts`, `functions/test/unit/shared/app-error.test.ts`, `functions/test/unit/shared/hash.test.ts`, `functions/test/unit/shared/async.test.ts`

**Interfaces:**
- Produces: `ErrorCode`, `ERROR_CODES`, `ERROR_CATALOG`, `httpStatusFor(code)`, `isRetryable(code)`, `defaultMessage(code)`, `ApiErrorBodySchema`; `class AppError(code, message?, details?, options?)`, `isAppError(e)`; `Logger`, `createLogger(base)`; `sha256Hex`, `fileIdForPath`, `uidHash`, `randomToken`, `utf8Bytes`; `Clock`, `systemClock`, `createFakeClock(startMs)`; `sleep`, `withTimeout`, `retry`; `firestore()`, `adminAuth()`; `paths.*`.

- [ ] **Step 1: Write the failing tests**

`test/unit/contracts/errors.test.ts`:
```ts
import { ERROR_CATALOG, ERROR_CODES, httpStatusFor, isRetryable } from '../../../src/contracts/errors.js';

describe('error catalog', () => {
  it('has an entry for every code', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_CATALOG[code]).toBeDefined();
      expect(ERROR_CATALOG[code].message.length).toBeGreaterThan(0);
    }
  });
  it('maps representative codes to HTTP statuses', () => {
    expect(httpStatusFor('UNAUTHENTICATED')).toBe(401);
    expect(httpStatusFor('GENERATION_IN_PROGRESS')).toBe(409);
    expect(httpStatusFor('LLM_RATE_LIMITED')).toBe(429);
    expect(httpStatusFor('HL_UNAVAILABLE')).toBe(502);
    expect(isRetryable('HL_RATE_LIMITED')).toBe(true);
    expect(isRetryable('HL_REAUTH_REQUIRED')).toBe(false);
  });
});
```

`test/unit/shared/app-error.test.ts`:
```ts
import { AppError, isAppError } from '../../../src/shared/app-error.js';

describe('AppError', () => {
  it('derives status, retryable and default message from the catalog', () => {
    const e = new AppError('FILE_VERSION_CONFLICT', undefined, { currentVersion: 4 });
    expect(e.status).toBe(409);
    expect(e.retryable).toBe(false);
    expect(e.message).toBe('This file changed since you opened it.');
    expect(e.details).toEqual({ currentVersion: 4 });
    expect(isAppError(e)).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
  });
});
```

`test/unit/shared/hash.test.ts`:
```ts
import { fileIdForPath, sha256Hex, utf8Bytes } from '../../../src/shared/hash.js';

describe('hash helpers', () => {
  it('computes stable file ids', () => {
    expect(fileIdForPath('index.html')).toBe(sha256Hex('index.html').slice(0, 20));
    expect(fileIdForPath('index.html')).toHaveLength(20);
  });
  it('counts UTF-8 bytes, not UTF-16 units', () => {
    expect(utf8Bytes('é')).toBe(2);
    expect(utf8Bytes('⟦')).toBe(3);
  });
});
```

`test/unit/shared/async.test.ts`:
```ts
import { retry, withTimeout } from '../../../src/shared/async.js';

describe('async helpers', () => {
  it('retries until success', async () => {
    let n = 0;
    const out = await retry(async () => { n += 1; if (n < 3) throw new Error('flaky'); return 'ok'; }, { attempts: 3, baseMs: 1 });
    expect(out).toBe('ok');
    expect(n).toBe(3);
  });
  it('times out', async () => {
    await expect(withTimeout(new Promise(() => undefined), 10, () => new Error('late'))).rejects.toThrow('late');
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test` → FAIL (modules not found).

- [ ] **Step 3: Implement `src/contracts/errors.ts`**

```ts
import { z } from 'zod';

export const ERROR_CODES = [
  'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_FAILED', 'PAYLOAD_TOO_LARGE',
  'PROJECT_NOT_FOUND', 'FILE_NOT_FOUND', 'SNAPSHOT_NOT_FOUND', 'GENERATION_NOT_FOUND',
  'GENERATION_IN_PROGRESS', 'DUPLICATE_REQUEST', 'FILE_VERSION_CONFLICT', 'SNAPSHOT_ALREADY_CURRENT',
  'GENERATION_NOT_APPLYABLE', 'PROJECT_LOCATION_MISMATCH',
  'GENERATION_INVALID_OUTPUT', 'GENERATION_REFUSED', 'GENERATION_TRUNCATED',
  'GENERATION_TIMEOUT', 'GENERATION_INTERRUPTED', 'CONTEXT_TOO_LARGE',
  'LLM_RATE_LIMITED', 'LLM_UNAVAILABLE',
  'HL_NOT_CONNECTED', 'HL_REAUTH_REQUIRED', 'HL_SCOPE_MISSING', 'HL_FORBIDDEN', 'HL_NOT_FOUND',
  'HL_BAD_REQUEST', 'HL_RATE_LIMITED', 'HL_UNAVAILABLE',
  'OAUTH_STATE_INVALID', 'OAUTH_DENIED', 'OAUTH_EXCHANGE_FAILED', 'OAUTH_NOT_LOCATION_TOKEN',
  'PREVIEW_LIMIT', 'PREVIEW_TIMEOUT', 'UNKNOWN_METHOD',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
export const ErrorCodeSchema = z.enum(ERROR_CODES);

interface ErrorSpec {
  readonly status: number;
  readonly retryable: boolean;
  readonly message: string;
}

export const ERROR_CATALOG: Readonly<Record<ErrorCode, ErrorSpec>> = {
  UNAUTHENTICATED: { status: 401, retryable: false, message: 'Please sign in again.' },
  FORBIDDEN: { status: 403, retryable: false, message: "You don't have access to this." },
  NOT_FOUND: { status: 404, retryable: false, message: 'Not found.' },
  VALIDATION_FAILED: { status: 400, retryable: false, message: 'Some input was invalid.' },
  PAYLOAD_TOO_LARGE: { status: 413, retryable: false, message: "That's larger than allowed." },
  PROJECT_NOT_FOUND: { status: 404, retryable: false, message: 'Project not found.' },
  FILE_NOT_FOUND: { status: 404, retryable: false, message: 'File not found.' },
  SNAPSHOT_NOT_FOUND: { status: 404, retryable: false, message: 'Snapshot not found.' },
  GENERATION_NOT_FOUND: { status: 404, retryable: false, message: 'Generation not found.' },
  GENERATION_IN_PROGRESS: { status: 409, retryable: true, message: 'A generation is already running for this project.' },
  DUPLICATE_REQUEST: { status: 409, retryable: false, message: 'This request was already submitted.' },
  FILE_VERSION_CONFLICT: { status: 409, retryable: false, message: 'This file changed since you opened it.' },
  SNAPSHOT_ALREADY_CURRENT: { status: 409, retryable: false, message: "That snapshot is already the current version." },
  GENERATION_NOT_APPLYABLE: { status: 409, retryable: false, message: "There's nothing to apply from this generation." },
  PROJECT_LOCATION_MISMATCH: { status: 409, retryable: false, message: 'This project was built for a different HighLevel location. Reconnect that location or create a new project.' },
  GENERATION_INVALID_OUTPUT: { status: 422, retryable: true, message: "The AI response couldn't be used safely." },
  GENERATION_REFUSED: { status: 422, retryable: false, message: 'The AI declined this request. Try rephrasing.' },
  GENERATION_TRUNCATED: { status: 422, retryable: true, message: 'The response was cut off before finishing.' },
  GENERATION_TIMEOUT: { status: 504, retryable: true, message: 'Generation took too long and was stopped.' },
  GENERATION_INTERRUPTED: { status: 503, retryable: true, message: 'The connection was lost during generation.' },
  CONTEXT_TOO_LARGE: { status: 413, retryable: false, message: 'The project is too large to send to the AI.' },
  LLM_RATE_LIMITED: { status: 429, retryable: true, message: 'The AI service is busy — try again shortly.' },
  LLM_UNAVAILABLE: { status: 503, retryable: true, message: 'The AI service is unavailable right now.' },
  HL_NOT_CONNECTED: { status: 409, retryable: false, message: 'Connect HighLevel to use live data.' },
  HL_REAUTH_REQUIRED: { status: 409, retryable: false, message: 'Your HighLevel connection expired — reconnect.' },
  HL_SCOPE_MISSING: { status: 403, retryable: false, message: "Genesis isn't allowed to do that in HighLevel. Reconnect to grant access." },
  HL_FORBIDDEN: { status: 403, retryable: false, message: 'HighLevel refused this request.' },
  HL_NOT_FOUND: { status: 404, retryable: false, message: "That HighLevel record wasn't found." },
  HL_BAD_REQUEST: { status: 422, retryable: false, message: 'HighLevel rejected the request.' },
  HL_RATE_LIMITED: { status: 429, retryable: true, message: 'HighLevel is rate limiting requests — try again shortly.' },
  HL_UNAVAILABLE: { status: 502, retryable: true, message: 'HighLevel is unavailable right now.' },
  OAUTH_STATE_INVALID: { status: 400, retryable: false, message: 'The connection link expired. Please try again.' },
  OAUTH_DENIED: { status: 400, retryable: false, message: 'Connection was cancelled.' },
  OAUTH_EXCHANGE_FAILED: { status: 502, retryable: true, message: "HighLevel didn't accept the connection. Please try again." },
  OAUTH_NOT_LOCATION_TOKEN: { status: 400, retryable: false, message: 'Please choose a sub-account (location), not an agency.' },
  PREVIEW_LIMIT: { status: 429, retryable: true, message: 'Too many HighLevel calls from the preview.' },
  PREVIEW_TIMEOUT: { status: 504, retryable: true, message: 'HighLevel call timed out.' },
  UNKNOWN_METHOD: { status: 400, retryable: false, message: 'Unknown SDK method.' },
  INTERNAL: { status: 500, retryable: true, message: 'Something went wrong. Please try again.' },
};

export const httpStatusFor = (code: ErrorCode): number => ERROR_CATALOG[code].status;
export const isRetryable = (code: ErrorCode): boolean => ERROR_CATALOG[code].retryable;
export const defaultMessage = (code: ErrorCode): string => ERROR_CATALOG[code].message;

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
```

- [ ] **Step 4: Implement `src/shared/app-error.ts`**

```ts
import { defaultMessage, httpStatusFor, isRetryable, type ErrorCode } from '../contracts/errors.js';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>, options?: { cause?: unknown }) {
    super(message ?? defaultMessage(code), options);
    this.name = 'AppError';
    this.code = code;
    this.status = httpStatusFor(code);
    this.retryable = isRetryable(code);
    this.details = details;
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
```

- [ ] **Step 5: Implement `src/shared/logger.ts`, `hash.ts`, `clock.ts`, `async.ts`**

`logger.ts`:
```ts
import * as fnLogger from 'firebase-functions/logger';

export type LogFields = Record<string, unknown>;
type Level = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export function createLogger(base: LogFields = {}): Logger {
  const emit = (level: Level) => (message: string, fields: LogFields = {}) => {
    fnLogger[level](message, { ...base, ...fields });
  };
  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}

/** Serializes an unknown error for server-side logs only. */
export function serializeError(err: unknown): LogFields {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return { value: String(err) };
}
```

`hash.ts`:
```ts
import { createHash, randomBytes } from 'node:crypto';

export const sha256Hex = (input: string | Buffer): string => createHash('sha256').update(input).digest('hex');
export const fileIdForPath = (path: string): string => sha256Hex(path).slice(0, 20);
export const uidHash = (uid: string): string => sha256Hex(uid).slice(0, 12);
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const utf8Bytes = (s: string): number => Buffer.byteLength(s, 'utf8');
```

`clock.ts`:
```ts
export interface Clock {
  now(): number; // epoch milliseconds
}

export const systemClock: Clock = { now: () => Date.now() };

export interface FakeClock extends Clock {
  advance(ms: number): void;
  set(ms: number): void;
}

export function createFakeClock(startMs: number): FakeClock {
  let t = startMs;
  return { now: () => t, advance: (ms) => { t += ms; }, set: (ms) => { t = ms; } };
}
```

`async.ts`:
```ts
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason as Error); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason as Error); }, { once: true });
  });
}

export async function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(onTimeout()), ms); });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface RetryOptions {
  attempts: number;
  baseMs: number;
  maxMs?: number;
  shouldRetry?: (err: unknown) => boolean;
}

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < opts.attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === opts.attempts - 1 || (opts.shouldRetry && !opts.shouldRetry(err))) break;
      const delay = Math.min(opts.maxMs ?? 2_000, opts.baseMs * 2 ** i) + Math.floor(Math.random() * opts.baseMs);
      await sleep(delay);
    }
  }
  throw lastErr;
}
```

- [ ] **Step 6: Implement `src/shared/firebase-admin.ts` and `src/shared/firestore-paths.ts`**

`firebase-admin.ts`:
```ts
import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let db: Firestore | undefined;

export const adminApp = (): App => getApps()[0] ?? initializeApp();

export function firestore(): Firestore {
  if (!db) {
    db = getFirestore(adminApp());
    db.settings({ ignoreUndefinedProperties: true });
  }
  return db;
}

export const adminAuth = (): Auth => getAuth(adminApp());
```

`firestore-paths.ts`:
```ts
const project = (uid: string, pid: string) => `users/${uid}/projects/${pid}`;

export const paths = {
  integration: (uid: string) => `users/${uid}/integrations/highlevel`,
  events: (uid: string) => `users/${uid}/events`,
  project,
  projects: (uid: string) => `users/${uid}/projects`,
  files: (uid: string, pid: string) => `${project(uid, pid)}/files`,
  file: (uid: string, pid: string, fileId: string) => `${project(uid, pid)}/files/${fileId}`,
  messages: (uid: string, pid: string) => `${project(uid, pid)}/messages`,
  generations: (uid: string, pid: string) => `${project(uid, pid)}/generations`,
  generation: (uid: string, pid: string, gid: string) => `${project(uid, pid)}/generations/${gid}`,
  staged: (uid: string, pid: string, gid: string) => `${project(uid, pid)}/generations/${gid}/staged`,
  rawArtifact: (uid: string, pid: string, gid: string) => `${project(uid, pid)}/generations/${gid}/artifacts/raw`,
  snapshots: (uid: string, pid: string) => `${project(uid, pid)}/snapshots`,
  snapshot: (uid: string, pid: string, sid: string) => `${project(uid, pid)}/snapshots/${sid}`,
  blob: (uid: string, pid: string, sha: string) => `${project(uid, pid)}/blobs/${sha}`,
  connection: (uid: string) => `hlConnections/${uid}`,
  connections: () => 'hlConnections',
  oauthState: (hash: string) => `oauthStates/${hash}`,
} as const;
```

- [ ] **Step 7: Run tests** — `npm test` → all pass. `npm run lint && npm run typecheck` → clean.

- [ ] **Step 8: Commit**

```bash
git add functions/src functions/test
git commit -m "feat(functions): add error catalog contract and shared kernel"
```

---

### Task BE-0.4: Parameters and runtime configuration

**Files:**
- Create: `functions/src/config/params.ts`, `functions/src/config/runtime-config.ts`
- Test: `functions/test/unit/config/runtime-config.test.ts`

**Interfaces:**
- Produces: secret params `ANTHROPIC_API_KEY`, `HL_CLIENT_ID`, `HL_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`; string params (URLs, model, effort, scopes, provider); `RuntimeConfig` type; `parseRuntimeConfig(raw)` (pure, tested); `loadRuntimeConfig()` (reads params; call only inside a request); `Secrets` type; `loadSecrets({ anthropic })`; `DEFAULT_HL_SCOPES` (the six read scopes).

- [ ] **Step 1: Write the failing test**

```ts
import { parseRuntimeConfig } from '../../../src/config/runtime-config.js';

const raw = {
  APP_BASE_URL: 'https://x.web.app',
  ALLOWED_ORIGINS: 'https://x.web.app, http://localhost:5173',
  HL_REDIRECT_URI: 'https://us-central1-x.cloudfunctions.net/api/v1/hl/oauth/callback',
  HL_SCOPES: 'contacts.readonly locations.readonly',
  HL_API_BASE_URL: 'https://services.leadconnectorhq.com',
  HL_AUTHORIZE_URL: 'https://marketplace.gohighlevel.com/v2/oauth/chooselocation',
  ANTHROPIC_MODEL: 'claude-opus-5',
  ANTHROPIC_EFFORT: 'medium',
  LLM_PROVIDER: 'fake',
  SSE_SMOKE_ENABLED: 'false',
};

describe('parseRuntimeConfig', () => {
  it('parses and normalizes values', () => {
    const c = parseRuntimeConfig(raw);
    expect(c.allowedOrigins).toEqual(['https://x.web.app', 'http://localhost:5173']);
    expect(c.hlScopes).toEqual(['contacts.readonly', 'locations.readonly']);
    expect(c.llmProvider).toBe('fake');
    expect(c.anthropicFastMode).toBe(false);
    expect(c.hlExtendedMethods).toBe(false);
  });
  it('rejects the word highlevel in the redirect URI', () => {
    expect(() => parseRuntimeConfig({ ...raw, HL_REDIRECT_URI: 'https://genesis-highlevel.web.app/cb' })).toThrow(/highlevel/i);
  });
  it('rejects unknown effort', () => {
    expect(() => parseRuntimeConfig({ ...raw, ANTHROPIC_EFFORT: 'ultra' })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- runtime-config` → FAIL.

- [ ] **Step 3: Implement `src/config/params.ts`**

```ts
import { defineInt, defineSecret, defineString } from 'firebase-functions/params';

/**
 * Read-only scopes for the core runtime methods (the assignment requires real data, not writes).
 * BE-1.3's contract test asserts this equals scopesForMethods(RUNTIME_METHOD_NAMES).
 */
export const DEFAULT_HL_SCOPES = [
  'contacts.readonly',
  'conversations.readonly',
  'conversations/message.readonly',
  'calendars.readonly',
  'calendars/events.readonly',
  'locations.readonly',
].join(' ');

export const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
export const HL_CLIENT_ID = defineSecret('HL_CLIENT_ID');
export const HL_CLIENT_SECRET = defineSecret('HL_CLIENT_SECRET');
export const TOKEN_ENCRYPTION_KEY = defineSecret('TOKEN_ENCRYPTION_KEY');

export const APP_BASE_URL = defineString('APP_BASE_URL');
export const ALLOWED_ORIGINS = defineString('ALLOWED_ORIGINS');
export const HL_REDIRECT_URI = defineString('HL_REDIRECT_URI');
export const HL_SCOPES = defineString('HL_SCOPES', { default: DEFAULT_HL_SCOPES });
export const HL_API_BASE_URL = defineString('HL_API_BASE_URL', { default: 'https://services.leadconnectorhq.com' });
export const HL_AUTHORIZE_URL = defineString('HL_AUTHORIZE_URL', {
  default: 'https://marketplace.gohighlevel.com/v2/oauth/chooselocation',
});
export const ANTHROPIC_MODEL = defineString('ANTHROPIC_MODEL', { default: 'claude-opus-5' });
export const ANTHROPIC_EFFORT = defineString('ANTHROPIC_EFFORT', { default: 'medium' });
export const LLM_PROVIDER = defineString('LLM_PROVIDER', { default: 'anthropic' });
export const SSE_SMOKE_ENABLED = defineString('SSE_SMOKE_ENABLED', { default: 'false' });
export const API_MIN_INSTANCES = defineInt('API_MIN_INSTANCES', { default: 0 });
export const GENERATE_MIN_INSTANCES = defineInt('GENERATE_MIN_INSTANCES', { default: 0 });
```

- [ ] **Step 4: Implement `src/config/runtime-config.ts`**

```ts
import { z } from 'zod';
import * as p from './params.js';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const csv = z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean));
const spaced = z.string().transform((s) => s.split(/\s+/).map((x) => x.trim()).filter(Boolean));

const RawSchema = z.object({
  APP_BASE_URL: z.url(),
  ALLOWED_ORIGINS: csv.pipe(z.array(z.string().min(1)).min(1)),
  HL_REDIRECT_URI: z.url().refine((u) => !/highlevel|leadconnector|ghl/i.test(u), {
    message: 'HL_REDIRECT_URI must not contain "highlevel", "leadconnector" or "ghl" (HighLevel rejects it)',
  }),
  HL_SCOPES: spaced.pipe(z.array(z.string()).min(1)),
  HL_API_BASE_URL: z.url(),
  HL_AUTHORIZE_URL: z.url(),
  ANTHROPIC_MODEL: z.string().min(1),
  ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
  LLM_PROVIDER: z.enum(['anthropic', 'fake']),
  SSE_SMOKE_ENABLED: bool,
});

export interface RuntimeConfig {
  readonly appBaseUrl: string;
  readonly allowedOrigins: readonly string[];
  readonly hlRedirectUri: string;
  readonly hlScopes: readonly string[];
  readonly hlApiBaseUrl: string;
  readonly hlAuthorizeUrl: string;
  readonly anthropicModel: string;
  readonly anthropicEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  readonly llmProvider: 'anthropic' | 'fake';
  readonly sseSmokeEnabled: boolean;
}

export function parseRuntimeConfig(raw: Record<string, unknown>): RuntimeConfig {
  const r = RawSchema.parse(raw);
  return Object.freeze({
    appBaseUrl: r.APP_BASE_URL.replace(/\/$/, ''),
    allowedOrigins: r.ALLOWED_ORIGINS,
    hlRedirectUri: r.HL_REDIRECT_URI,
    hlScopes: r.HL_SCOPES,
    hlApiBaseUrl: r.HL_API_BASE_URL.replace(/\/$/, ''),
    hlAuthorizeUrl: r.HL_AUTHORIZE_URL,
    anthropicModel: r.ANTHROPIC_MODEL,
    anthropicEffort: r.ANTHROPIC_EFFORT,
    llmProvider: r.LLM_PROVIDER,
    sseSmokeEnabled: r.SSE_SMOKE_ENABLED,
  });
}

/** Reads Firebase params. Call only while handling a request (never at module load). */
export function loadRuntimeConfig(): RuntimeConfig {
  return parseRuntimeConfig({
    APP_BASE_URL: p.APP_BASE_URL.value(),
    ALLOWED_ORIGINS: p.ALLOWED_ORIGINS.value(),
    HL_REDIRECT_URI: p.HL_REDIRECT_URI.value(),
    HL_SCOPES: p.HL_SCOPES.value(),
    HL_API_BASE_URL: p.HL_API_BASE_URL.value(),
    HL_AUTHORIZE_URL: p.HL_AUTHORIZE_URL.value(),
    ANTHROPIC_MODEL: p.ANTHROPIC_MODEL.value(),
    ANTHROPIC_EFFORT: p.ANTHROPIC_EFFORT.value(),
    LLM_PROVIDER: p.LLM_PROVIDER.value(),
    SSE_SMOKE_ENABLED: p.SSE_SMOKE_ENABLED.value(),
  });
}

export interface Secrets {
  readonly anthropicApiKey: string | null;
  readonly hlClientId: string;
  readonly hlClientSecret: string;
  readonly tokenEncryptionKey: string;
}

export function loadSecrets(opts: { anthropic: boolean }): Secrets {
  return Object.freeze({
    anthropicApiKey: opts.anthropic ? p.ANTHROPIC_API_KEY.value() : null,
    hlClientId: p.HL_CLIENT_ID.value(),
    hlClientSecret: p.HL_CLIENT_SECRET.value(),
    tokenEncryptionKey: p.TOKEN_ENCRYPTION_KEY.value(),
  });
}
```

- [ ] **Step 5: Run tests** — `npm test` → pass.

- [ ] **Step 6: Commit**

```bash
git add functions/src/config functions/test/unit/config
git commit -m "feat(functions): add typed params and validated runtime config"
```

---

### Task BE-0.5: HTTP app factory, middleware, health, function exports

**Files:**
- Create: `functions/src/http/respond.ts`, `functions/src/http/define-handler.ts`, `functions/src/http/middleware/request-context.ts`, `functions/src/http/middleware/cors.ts`, `functions/src/http/middleware/require-auth.ts`, `functions/src/http/middleware/no-store.ts`, `functions/src/http/middleware/error-handler.ts`, `functions/src/http/create-http-app.ts`, `functions/src/composition.ts`
- Modify: `functions/src/index.ts`
- Test: `functions/test/unit/http/create-http-app.test.ts`

**Interfaces:**
- Produces: `createHttpApp(opts: HttpAppOptions): Express` with `HttpAppOptions = { service: 'api' | 'generate'; version: string; allowedOrigins: readonly string[]; logger: Logger; verifyIdToken: VerifyIdToken; publicRouters?: Router[]; authedRouters?: Router[] }`; `VerifyIdToken = (token: string) => Promise<{ uid: string; email?: string | undefined }>`; `defineHandler(schemas, fn)`; `requireUid(req): string`; `sendData(res, data, status?)`; `req.ctx: { requestId: string; startedAt: number; log: Logger }`; `req.auth?: { uid: string; email?: string }`; composition `getApiApp()`, `getGenerateApp()`. Per-route Cloud Function rate limits are out of v1 (R-B4).

- [ ] **Step 1: Write the failing tests**

`test/unit/http/create-http-app.test.ts`:
```ts
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { createHttpApp } from '../../../src/http/create-http-app.js';
import { defineHandler } from '../../../src/http/define-handler.js';
import { sendData } from '../../../src/http/respond.js';
import { AppError } from '../../../src/shared/app-error.js';
import { createLogger } from '../../../src/shared/logger.js';

function makeApp() {
  const authed = express.Router();
  authed.get('/v1/me', (req, res) => { sendData(res, { uid: req.auth?.uid }); });
  authed.post('/v1/echo', defineHandler({ body: z.strictObject({ n: z.number() }) }, (input, _req, res) => { sendData(res, { n: input.body.n }); }));
  authed.get('/v1/boom', () => { throw new AppError('FILE_VERSION_CONFLICT', undefined, { currentVersion: 3 }); });
  return createHttpApp({
    service: 'api',
    version: 'test',
    allowedOrigins: ['https://app.example'],
    logger: createLogger({ test: true }),
    verifyIdToken: async (t) => { if (t !== 'good') throw new Error('bad'); return { uid: 'u1' }; },
    authedRouters: [authed],
  });
}

describe('createHttpApp', () => {
  it('serves health publicly with a request id', async () => {
    const res = await request(makeApp()).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { ok: true, service: 'api', version: 'test' } });
    expect(res.headers['x-request-id']).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('rejects missing or bad tokens with the error envelope', async () => {
    const res = await request(makeApp()).get('/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'UNAUTHENTICATED', retryable: false });
    expect(res.body.error.requestId).toBeTruthy();
    const bad = await request(makeApp()).get('/v1/me').set('Authorization', 'Bearer nope');
    expect(bad.status).toBe(401);
  });
  it('passes authenticated requests', async () => {
    const res = await request(makeApp()).get('/v1/me').set('Authorization', 'Bearer good');
    expect(res.body).toEqual({ data: { uid: 'u1' } });
  });
  it('maps AppError and zod errors', async () => {
    const boom = await request(makeApp()).get('/v1/boom').set('Authorization', 'Bearer good');
    expect(boom.status).toBe(409);
    expect(boom.body.error).toMatchObject({ code: 'FILE_VERSION_CONFLICT', details: { currentVersion: 3 } });
    const invalid = await request(makeApp()).post('/v1/echo').set('Authorization', 'Bearer good').send({ n: 'x' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
  });
  it('returns 404 for unknown authenticated routes', async () => {
    const res = await request(makeApp()).get('/v1/nope').set('Authorization', 'Bearer good');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
  it('answers CORS preflight only for allowed origins', async () => {
    const ok = await request(makeApp()).options('/v1/me').set('Origin', 'https://app.example').set('Access-Control-Request-Method', 'GET');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.example');
    const denied = await request(makeApp()).options('/v1/me').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify they fail** — FAIL (modules missing).

- [ ] **Step 3: Implement `respond.ts`, `define-handler.ts`, middleware**

`src/http/respond.ts`:
```ts
import type { Response } from 'express';

export function sendData<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ data });
}
```

`src/http/middleware/request-context.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from '../../shared/logger.js';

export interface RequestContext {
  readonly requestId: string;
  readonly startedAt: number;
  readonly log: Logger;
}
export interface AuthContext {
  readonly uid: string;
  readonly email?: string | undefined;
}

declare module 'express-serve-static-core' {
  interface Request {
    ctx: RequestContext;
    auth?: AuthContext;
  }
}

const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export function requestContext(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    const requestId = incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    req.ctx = { requestId, startedAt: Date.now(), log: logger.child({ requestId, route: `${req.method} ${req.path}` }) };
    res.setHeader('X-Request-Id', requestId);
    next();
  };
}
```

`src/http/middleware/cors.ts`:
```ts
import cors from 'cors';
import type { RequestHandler } from 'express';

export function corsMiddleware(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return cors({
    origin: (origin, cb) => { cb(null, !origin || allowed.has(origin)); },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    credentials: false,
    maxAge: 600,
    optionsSuccessStatus: 204,
  });
}
```

`src/http/middleware/no-store.ts`:
```ts
import type { RequestHandler } from 'express';

export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};
```

`src/http/middleware/require-auth.ts`:
```ts
import type { RequestHandler } from 'express';
import { AppError } from '../../shared/app-error.js';

export type VerifyIdToken = (token: string) => Promise<{ uid: string; email?: string | undefined }>;

export function requireAuth(verify: VerifyIdToken): RequestHandler {
  return async (req, _res, next) => {
    const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '');
    const token = match?.[1];
    if (!token) throw new AppError('UNAUTHENTICATED');
    try {
      const decoded = await verify(token);
      req.auth = { uid: decoded.uid, email: decoded.email };
    } catch (err) {
      throw new AppError('UNAUTHENTICATED', undefined, undefined, { cause: err });
    }
    next();
  };
}
```

`src/http/middleware/error-handler.ts`:
```ts
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../../shared/app-error.js';
import { serializeError } from '../../shared/logger.js';

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return new AppError('VALIDATION_FAILED', undefined, { issues });
  }
  if (err instanceof SyntaxError && 'body' in err) return new AppError('VALIDATION_FAILED', 'Malformed JSON body');
  return new AppError('INTERNAL', undefined, undefined, { cause: err });
}

export const notFound: RequestHandler = () => {
  throw new AppError('NOT_FOUND');
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appErr = toAppError(err);
  const log = req.ctx.log;
  if (appErr.status >= 500) log.error('request.failed', { code: appErr.code, error: serializeError(appErr.cause ?? err) });
  else log.warn('request.rejected', { code: appErr.code });
  if (res.headersSent) {
    res.end();
    return;
  }
  const retryAfterMs = appErr.details?.['retryAfterMs'];
  if (typeof retryAfterMs === 'number') res.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
  res.status(appErr.status).json({
    error: {
      code: appErr.code,
      message: appErr.message,
      retryable: appErr.retryable,
      ...(appErr.details ? { details: appErr.details } : {}),
      requestId: req.ctx.requestId,
    },
  });
};
```

`src/http/define-handler.ts`:
```ts
import type { Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import { AppError } from '../shared/app-error.js';

/** The authenticated uid (authed routers run after requireAuth; this guards misuse). */
export function requireUid(req: Request): string {
  const uid = req.auth?.uid;
  if (!uid) throw new AppError('UNAUTHENTICATED');
  return uid;
}

export interface RouteSchemas {
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
}
type Infer<T> = T extends z.ZodType ? z.infer<T> : undefined;
export interface Parsed<S extends RouteSchemas> {
  params: Infer<S['params']>;
  query: Infer<S['query']>;
  body: Infer<S['body']>;
}

/** Parses params/query/body with zod before calling the handler (ZodError → VALIDATION_FAILED). */
export function defineHandler<S extends RouteSchemas>(
  schemas: S,
  fn: (input: Parsed<S>, req: Request, res: Response) => Promise<void> | void,
): RequestHandler {
  return async (req, res) => {
    const input = {
      params: schemas.params ? schemas.params.parse(req.params) : undefined,
      query: schemas.query ? schemas.query.parse(req.query) : undefined,
      body: schemas.body ? schemas.body.parse(req.body ?? {}) : undefined,
    } as Parsed<S>;
    await fn(input, req, res);
  };
}
```

- [ ] **Step 4: Skip Cloud Function rate limits** — assignment bonus R-B4 is out of v1. Do not add `modules/rate-limit`, `middleware/rate-limit.ts`, or Firestore `rateLimits`.

- [ ] **Step 5: Implement `src/http/create-http-app.ts`**

```ts
import express, { type Express, type Router } from 'express';
import type { Logger } from '../shared/logger.js';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { noStore } from './middleware/no-store.js';
import { requestContext } from './middleware/request-context.js';
import { requireAuth, type VerifyIdToken } from './middleware/require-auth.js';
import { sendData } from './respond.js';

export interface HttpAppOptions {
  readonly service: 'api' | 'generate' | 'webhook';
  readonly version: string;
  readonly allowedOrigins: readonly string[];
  readonly logger: Logger;
  readonly verifyIdToken: VerifyIdToken;
  readonly publicRouters?: readonly Router[];
  readonly authedRouters?: readonly Router[];
}

export function createHttpApp(opts: HttpAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(requestContext(opts.logger));
  app.use(corsMiddleware(opts.allowedOrigins));
  app.use(noStore);

  app.get('/v1/health', (_req, res) => {
    sendData(res, { ok: true, service: opts.service, version: opts.version });
  });
  for (const r of opts.publicRouters ?? []) app.use(r);

  const authed = express.Router();
  authed.use(requireAuth(opts.verifyIdToken));
  for (const r of opts.authedRouters ?? []) authed.use(r);
  app.use(authed);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 6: Composition root and exports**

`src/composition.ts` (grows in later phases — each phase adds its routers here):
```ts
import type { Express, Router } from 'express';
import { loadRuntimeConfig, type RuntimeConfig } from './config/runtime-config.js';
import { createHttpApp } from './http/create-http-app.js';
import { adminAuth } from './shared/firebase-admin.js';
import { createLogger } from './shared/logger.js';

export const VERSION = process.env['K_REVISION'] ?? 'dev';

let apiApp: Express | undefined;
let generateApp: Express | undefined;

const verifyIdToken = async (token: string) => {
  const d = await adminAuth().verifyIdToken(token);
  return { uid: d.uid, email: d.email };
};

function buildApiApp(config: RuntimeConfig): Express {
  const logger = createLogger({ service: 'api' });
  const publicRouters: Router[] = [];
  const authedRouters: Router[] = [];
  // Phase BE-3+ registers routers here.
  return createHttpApp({ service: 'api', version: VERSION, allowedOrigins: config.allowedOrigins, logger, verifyIdToken, publicRouters, authedRouters });
}

function buildGenerateApp(config: RuntimeConfig): Express {
  const logger = createLogger({ service: 'generate' });
  const publicRouters: Router[] = [];
  const authedRouters: Router[] = [];
  // BE-0.6 adds the SSE smoke route; BE-6.6 adds the generation route.
  return createHttpApp({ service: 'generate', version: VERSION, allowedOrigins: config.allowedOrigins, logger, verifyIdToken, publicRouters, authedRouters });
}

export function getApiApp(): Express {
  apiApp ??= buildApiApp(loadRuntimeConfig());
  return apiApp;
}

export function getGenerateApp(): Express {
  generateApp ??= buildGenerateApp(loadRuntimeConfig());
  return generateApp;
}
```

`src/index.ts`:
```ts
import { onRequest } from 'firebase-functions/https';
import { setGlobalOptions } from 'firebase-functions/options';
import { getApiApp, getGenerateApp } from './composition.js';
import {
  ANTHROPIC_API_KEY,
  API_MIN_INSTANCES,
  GENERATE_MIN_INSTANCES,
  HL_CLIENT_ID,
  HL_CLIENT_SECRET,
  TOKEN_ENCRYPTION_KEY,
} from './config/params.js';

setGlobalOptions({ region: 'us-central1' });

export const api = onRequest(
  {
    timeoutSeconds: 60,
    memory: '512MiB',
    concurrency: 80,
    maxInstances: 10,
    minInstances: API_MIN_INSTANCES,
    invoker: 'public',
    secrets: [HL_CLIENT_ID, HL_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY],
  },
  (req, res) => { getApiApp()(req, res); },
);

export const generate = onRequest(
  {
    timeoutSeconds: 540,
    memory: '1GiB',
    concurrency: 20,
    maxInstances: 5,
    minInstances: GENERATE_MIN_INSTANCES,
    invoker: 'public',
    secrets: [ANTHROPIC_API_KEY, HL_CLIENT_ID, HL_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY],
  },
  (req, res) => { getGenerateApp()(req, res); },
);
```

- [ ] **Step 7: Run tests, lint, typecheck, build** — all pass/clean.

- [ ] **Step 8: Commit**

```bash
git add functions/src functions/test
git commit -m "feat(functions): add HTTP app factory, middleware, rate limiter and function exports"
```

---

### Task BE-0.6: Emulators, first deploy, production SSE smoke test (spike S12)

**Files:**
- Create: `functions/src/http/sse-smoke.routes.ts`
- Modify: `functions/src/composition.ts` (mount smoke route when `config.sseSmokeEnabled`)

**Interfaces:** Produces public `GET /v1/health/stream` on `generate` (only when `SSE_SMOKE_ENABLED=true`).

- [ ] **Step 1: Implement the smoke route**

`src/http/sse-smoke.routes.ts`:
```ts
import express, { type Router } from 'express';

/** Streams 5 events one second apart; proves responses are not buffered end-to-end. */
export function sseSmokeRouter(): Router {
  const r = express.Router();
  r.get('/v1/health/stream', (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    let n = 0;
    const timer = setInterval(() => {
      n += 1;
      res.write(`event: tick\nid: ${n}\ndata: ${JSON.stringify({ n, at: new Date().toISOString() })}\n\n`);
      if (n === 5) { clearInterval(timer); res.end(); }
    }, 1_000);
    req.on('close', () => clearInterval(timer));
  });
  return r;
}
```

In `buildGenerateApp` add: `if (config.sseSmokeEnabled) publicRouters.push(sseSmokeRouter());` (import from `./http/sse-smoke.routes.js`).

- [ ] **Step 2: Run the emulators**

```bash
cd /Users/mac/Developer/genesis
npm --prefix functions run build
firebase emulators:start --only functions,firestore,auth
```
In another terminal:
```bash
curl -s http://127.0.0.1:5001/genesis-builder-7f3a/us-central1/api/v1/health
curl -N http://127.0.0.1:5001/genesis-builder-7f3a/us-central1/generate/v1/health/stream
```
Expected: health JSON `{"data":{"ok":true,"service":"api","version":"dev"}}`; the stream prints one `event: tick` per second (5 total).

- [ ] **Step 3: Set production secrets and params, deploy functions**

```bash
firebase use genesis-builder-7f3a
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase functions:secrets:set HL_CLIENT_ID
firebase functions:secrets:set HL_CLIENT_SECRET
firebase functions:secrets:set TOKEN_ENCRYPTION_KEY
cp functions/.env.example functions/.env.genesis-builder-7f3a   # edit values; set SSE_SMOKE_ENABLED=true for today
firebase deploy --only functions
```
Expected: `✔ functions[api(us-central1)] Successful create operation.` and the same for `generate`; the CLI prints both URLs.

- [ ] **Step 4: Verify production streaming (spike S12)**

```bash
curl -s https://us-central1-genesis-builder-7f3a.cloudfunctions.net/api/v1/health
curl -N https://us-central1-genesis-builder-7f3a.cloudfunctions.net/generate/v1/health/stream
```
Expected: ticks arrive **one per second** (not all at once after 5 s). If they arrive together, stop and investigate before building generation (check for compression or a proxy in between).

- [ ] **Step 5: Turn the smoke route off** — set `SSE_SMOKE_ENABLED=false` in `functions/.env.genesis-builder-7f3a` (redeploy happens with the next phase).

- [ ] **Step 6: Commit**

```bash
git add functions/src
git commit -m "feat(functions): add gated SSE smoke route and verify streaming in production"
```
