# Genesis Backend — Implementation Plan (overview)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Give each worker: this overview's **Global Constraints** + **Coding Standards** + the single task it owns.

**Goal:** Build the Genesis Firebase backend — HighLevel OAuth and token lifecycle, an allow-listed HighLevel runtime proxy, a streaming (SSE) Claude generation pipeline with validation, staging, atomic commits and snapshots, manual save and restore — deployed as Cloud Functions 2nd gen.

**Architecture:** Two Express 5 apps behind `onRequest` (`api` for REST, `generate` for SSE) on Node 24, Firestore as the only datastore, secrets in Secret Manager. Shared zod contracts in `functions/src/contracts/` (copied to the frontend). Pure core modules (parser, validators, adapters, outcome, rendering) wrapped by thin I/O shells (repositories, HTTP clients, providers).

**Tech stack:** Node 24 · TypeScript 5.9 (ESM, NodeNext) · firebase-functions 7.4 · firebase-admin 14.5 · Express 5 · zod 4 · @anthropic-ai/sdk 0.128 · acorn 8 · parse5 8 · Vitest 5 · supertest · @firebase/rules-unit-testing 5 · firebase-tools 15.

**Spec:** [`../05-backend-system-design.md`](../05-backend-system-design.md) (how) and [`../07-end-to-end-system-design.md`](../07-end-to-end-system-design.md) §3 (canonical contracts). Background: [`../research/`](../research/).

---

## Global Constraints

- Node **24** (`.nvmrc` = `24`; `engines.node` = `"24"`; `firebase.json` `runtime: "nodejs24"`). Never Node 20.
- TypeScript **5.9.x** (not 7.x). `"type": "module"`, `module`/`moduleResolution` = `NodeNext`; **every relative import ends in `.js`**; `import type` for type-only imports.
- zod **4.x** (`z.strictObject`, `z.uuid()`, `z.email()`, `z.iso.datetime()`); contracts import only `zod`.
- Express **5** (bundled with firebase-functions 7). Do **not** mount `express.json()`; use `req.body` / `req.rawBody` from the Functions runtime.
- Region `us-central1`; Firestore `nam5`; function names `api`, `generate`, and `hlWebhook`.
- Secrets only through `defineSecret`: `ANTHROPIC_API_KEY`, `HL_CLIENT_ID`, `HL_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`. Never read secrets at module load.
- HighLevel: base `https://services.leadconnectorhq.com`; `Version: 2021-07-28` for Contacts/Locations, `2021-04-15` for Calendars/Conversations; `/oauth/token` is **form-urlencoded**; authorize URL `https://marketplace.gohighlevel.com/v2/oauth/chooselocation`; redirect path `/v1/hl/oauth/callback` (never the word "highlevel" in the redirect URI).
- Runtime surface: **seven read methods** (`location.get`, `contacts.list`, `contacts.get`, `conversations.list`, `conversations.messages`, `calendars.list`, `calendars.events`). Create/update/send/free-slots are assignment “familiarize” verbs, not product methods. Every consumer (routes, service, location context, system prompt, bridge, runtime) derives the set from the manifest in `contracts/hl-runtime.ts`.
- Scopes (exact): `contacts.readonly conversations.readonly conversations/message.readonly calendars.readonly calendars/events.readonly locations.readonly`.
- Implemented bonuses: user cancel (R-B1), Cloud Function rate limits / kill switch / global cap (R-B4), webhooks (R-B6). Still out: eval harness, Anthropic fast mode, HighLevel write adapters.
- Claude: `client.beta.messages.stream`, model from `ANTHROPIC_MODEL` (default `claude-opus-5`), `thinking: { type: 'adaptive', display: 'summarized' }`, `output_config: { effort }` (default `medium`), `betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`, `max_tokens: 32000`, request `signal`. Never disable thinking; never send `temperature`.
- Limits (exact, from `contracts/limits.ts`): prompt ≤ 4,000 chars; ≤ 25 files; file ≤ 102,400 UTF-8 bytes; project ≤ 307,200 bytes; path depth ≤ 3 segments; history 12 messages × 4,000 chars; generation deadline 300 s; heartbeat 15 s; stale lease 60 s; OAuth state TTL 10 min.
- Error envelope, codes and HTTP statuses exactly as `07` §3.6. SSE events exactly as `07` §3.2. Firestore paths/fields exactly as `07` §3.5.
- No HTTP/network call inside a Firestore transaction callback. Ever.
- Never log or return tokens, secrets, prompts' full text, file contents or HighLevel records.

## Coding Standards

| Rule              | Detail                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Strictness        | `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes: false`                                      |
| Types             | No `any` (lint error). Parse unknown input with zod. Prefer `readonly` and discriminated unions                                                                    |
| Modules           | Named exports only; one responsibility per file; ≲ 300 lines per file; ≲ 50 lines per function where practical                                                     |
| Layering          | routes → services → repos/clients → shared/contracts. Routes never touch Firestore; services never touch `req/res` (orchestrator excepted: it owns the SSE writer) |
| Errors            | Throw `AppError(code, message?, details?)`. Never throw strings. Never swallow errors silently — log with context or rethrow                                       |
| Async             | No floating promises (`@typescript-eslint/no-floating-promises`); `await` or `void` with a `.catch` that logs                                                      |
| Time & randomness | Inject `Clock`; generate IDs via `shared/hash.ts`/`crypto.randomUUID()` only                                                                                       |
| Tests             | Vitest; unit tests next to nothing — they live in `test/unit/**` mirroring `src/**`; integration tests in `test/integration/**` run under the emulators            |
| Comments          | Explain _why_; no commented-out code; no TODOs in merged code (open an issue instead)                                                                              |
| Naming            | Files kebab-case (`token-manager.ts`); classes PascalCase; functions camelCase; constants UPPER_SNAKE                                                              |

## File map (backend + root)

```
genesis/
├── .github/workflows/ci.yml · deploy.yml          (BE-0.1 stub; finalized in 10-delivery doc)
├── firebase.json · .firebaserc · firestore.rules · firestore.indexes.json   (BE-0.1, BE-2)
├── .env.example · .gitignore · .editorconfig · .nvmrc · .prettierrc.json · package.json · LICENSE · README.md  (BE-0.1)
├── scripts/sync-contracts.mjs                                              (BE-1.6)
└── functions/
    ├── package.json · tsconfig.json · tsconfig.test.json · eslint.config.js
    ├── vitest.config.ts · vitest.integration.config.ts · .env.example · .secret.local.example   (BE-0.2)
    ├── src/
    │   ├── index.ts                                   (BE-0.5, BE-6.6)
    │   ├── config/params.ts · runtime-config.ts        (BE-0.4)
    │   ├── contracts/errors.ts                         (BE-0.3)
    │   ├── contracts/limits.ts · paths.ts · firestore-docs.ts · hl-runtime.ts · api.ts · sse.ts · bridge.ts · index.ts   (BE-1)
    │   ├── shared/app-error.ts · logger.ts · hash.ts · clock.ts · async.ts · firebase-admin.ts · firestore-paths.ts     (BE-0.3)
    │   ├── composition.ts                             (BE-0.5; grows in BE-3…BE-8)
    │   ├── http/create-http-app.ts · define-handler.ts · respond.ts · middleware/*   (BE-0.5)
    │   ├── http/sse-smoke.routes.ts                                              (BE-0.6)
    │   ├── modules/projects/project-access.ts                                    (BE-4.4)
    │   ├── modules/highlevel/connection/*  oauth/*                               (BE-3)
    │   ├── modules/highlevel/client/* adapters/* runtime/* metadata/*            (BE-4)
    │   ├── modules/generation/protocol/* validation/* prompt/* context/* llm/* sse/*   (BE-5)
    │   ├── modules/generation/persistence/* outcome.ts orchestrator.ts generate.app.ts routes/*  (BE-6)
    │   ├── modules/snapshots/* files/*                                           (BE-6.3, BE-7)
    ├── test/unit/** · test/integration/** · test/rules/** · test/fixtures/** · test/helpers/**
    └── scripts/spike-oauth.ts · seed-pit-connection.ts · record-hl-fixtures.ts  (BE-3.5, BE-3.8, BE-4.7)
```

Full repository tree (frontend included): [`../04-high-level-design.md`](../04-high-level-design.md) §10.

## Phases and tasks

| Phase                  | File                                                                       | Tasks                                                                                                                                                                     | Day | Depends on            |
| ---------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --------------------- |
| BE-0 Foundation        | [`01-foundation.md`](01-foundation.md)                                     | 0.1 root scaffold · 0.2 functions tooling · 0.3 error catalog + shared kernel · 0.4 config · 0.5 HTTP apps, middleware, health · 0.6 emulators + first deploy + SSE smoke | 1   | Prerequisites         |
| BE-1 Contracts         | [`02-contracts.md`](02-contracts.md)                                       | 1.1 limits + paths · 1.2 Firestore docs · 1.3 HL runtime manifest · 1.4 REST DTOs · 1.5 SSE + bridge · 1.6 index + sync + drift check                                     | 1   | BE-0                  |
| BE-2 Rules             | [`03-firestore-rules.md`](03-firestore-rules.md)                           | 2.1 rules · 2.2 indexes + TTL · 2.3 rules tests                                                                                                                           | 1   | BE-1                  |
| BE-3 OAuth & tokens    | [`04-highlevel-oauth-and-tokens.md`](04-highlevel-oauth-and-tokens.md)     | 3.1 cipher · 3.2 connection repo · 3.3 token endpoint · 3.4 OAuth state repo · 3.5 OAuth service/routes · 3.6 token manager · 3.7 disconnect · 3.8 PIT seed               | 2   | BE-0..2               |
| BE-4 Runtime proxy     | [`05-highlevel-runtime-proxy.md`](05-highlevel-runtime-proxy.md)           | 4.1 HTTP client · 4.2 cursor + normalize · 4.3 read adapters · 4.4 project access + runtime service · 4.5 routes · 4.6 location context · 4.7 fixture recorder            | 2   | BE-3                  |
| BE-5 Generation core   | [`06-generation-core.md`](06-generation-core.md)                           | 5.1 parser · 5.2 file validation · 5.3 project validation · 5.4 prompt · 5.5 context builder · 5.6 providers · 5.7 fake provider · 5.8 SSE writer                         | 3   | BE-1 (BE-4.6 for 5.5) |
| BE-6 Orchestration     | [`07-generation-orchestration.md`](07-generation-orchestration.md)         | 6.1 generations repo · 6.2 lease · 6.3 blobs + snapshot builder · 6.4 commit · 6.5 outcome + orchestrator · 6.6 generate app · 6.7 apply/discard · 6.8 scenario matrix    | 3   | BE-5                  |
| BE-7 Files & snapshots | [`08-files-and-snapshots.md`](08-files-and-snapshots.md)                   | 7.1 manual save · 7.2 restore · 7.3 tests                                                                                                                                 | 4   | BE-6                  |
| BE-8 Deploy            | [`09-hardening-bonuses-and-deploy.md`](09-hardening-bonuses-and-deploy.md) | 8.6 prod deploy + smoke                                                                                                                                                   | 4–5 | all                   |

## Command cheat sheet (run from `functions/` unless noted)

```bash
npm ci                                  # install
npm run build                           # tsc → lib/
npm run lint                            # eslint
npm run typecheck                       # tsc --noEmit -p tsconfig.test.json
npm test                                # unit tests (no emulator)
npm run test:integration                # needs emulators: see below
firebase emulators:exec --only auth,firestore "npm --prefix functions run test:integration"   # from repo root
firebase emulators:exec --only firestore "npm --prefix functions run test:rules"             # from repo root
firebase emulators:start                # from repo root (auth, firestore, functions, ui)
firebase deploy --only functions,firestore   # from repo root
node ../scripts/sync-contracts.mjs --check   # contract drift check
```

## Commits and branches

- Branch per phase: `feat/be-0-foundation`, `feat/be-3-oauth`, … (or trunk-based commits on `main` if solo and CI is green — see `10-delivery-git-and-deployment.md`).
- Conventional Commits: `feat(functions): …`, `test(functions): …`, `chore(repo): …`, `fix(functions): …`, `docs: …`.
- Each task ends with a commit; never commit `.env.local`, `.env.<projectId>`, `.secret.local`, fixtures with tokens.

## Definition of done (backend)

- All unit, integration and rules tests pass; lint and typecheck clean; `sync-contracts --check` clean.
- `api`, `generate` deployed on `nodejs24`; health endpoints return 200; SSE streams incrementally from production.
- OAuth connect works against the sandbox with the production redirect URI; projection shows location name.
- The seven runtime methods return normalized data from the sandbox; pagination verified with ≥ 30 contacts (cursors exist; generated apps are not required to render Load more).
- Generation scenario matrix passes with the fake provider; one real Claude generation produces a working app.
- Save, restore, apply-partial, discard work end-to-end; checkpoints protect manual edits.
- No secret in git history (`gitleaks detect` clean).
