# Research 03 — Firebase platform facts for Genesis

**Date:** 2026-09-26
**Sources:** Firebase docs (Functions HTTP events, config-env, manage-functions, Hosting + Functions, Emulator Suite), Google Cloud runtime-support schedule, `firebase-functions@7.4.0` / `firebase-admin@14.5.0` / `firebase@12.19.0` / `firebase-tools@15.31.0` package metadata (npm, 2026-09-26), firebase-tools issue #3175 (emulator vs prod streaming), Cloud Run CPU-allocation guidance.
**Purpose:** Pin the platform behaviors our design depends on — especially streaming, timeouts, secrets, emulators and Firestore limits.

---

## 1. Runtime versions (decision-critical)

| Runtime      | Status                             | Deprecation    | Decommission   |
| ------------ | ---------------------------------- | -------------- | -------------- |
| nodejs18     | GA                                 | 2025-04-30     | 2025-10-30     |
| **nodejs20** | GA                                 | **2026-04-30** | **2026-10-30** |
| nodejs22     | GA                                 | 2027-04-30     | 2027-10-31     |
| **nodejs24** | GA (2nd gen / Cloud Run functions) | 2028-04-30     | 2028-10-31     |
| nodejs26     | Preview                            | —              | —              |

**Decision: Node.js 24** for Cloud Functions (`"engines": { "node": "24" }`, `firebase.json` `runtime: "nodejs24"`) and for local development (`.nvmrc` = `24`). Reasons: Node 20 becomes **undeployable on 2026-10-30**, inside the review window; Node 24 is the active LTS, GA on 2nd-gen functions, supported by current firebase-tools, and matches the developer machine (v24.15.0). Node 24 is **not** available for 1st-gen functions — irrelevant because every Genesis function is 2nd gen.

## 2. Package versions (2026-09-26) and compatibility

| Package                        | Version | Note                                                                             |
| ------------------------------ | ------- | -------------------------------------------------------------------------------- |
| `firebase-functions`           | 7.4.0   | Depends on **Express 5** (`express ^5.2.1`, `@types/express ^5`) — use Express 5 |
| `firebase-admin`               | 14.5.0  | Peer-compatible with functions 7                                                 |
| `firebase` (web)               | 12.19.0 | Modular API; required peer of rules-unit-testing 5                               |
| `firebase-tools`               | 15.31.0 | **Emulators require Java 21+** since v15 (Java < 21 dropped)                     |
| `@firebase/rules-unit-testing` | 5.0.2   | Needs Node ≥ 20 and `firebase ^12`                                               |

Import paths in `firebase-functions` 7: `firebase-functions/https` (v2 `onRequest`), `firebase-functions/options` (`setGlobalOptions`), `firebase-functions/params` (`defineSecret`, `defineString`, `defineInt`, `defineList`), `firebase-functions/logger`. The package ships ESM (`import` condition), so `"type": "module"` in `functions/package.json` is supported.

## 3. HTTP functions (2nd gen) — options we use

`onRequest(opts, handler)` where `handler` can be an Express app. Options (`HttpsOptions`): `region`, `cors` (default **false** for `onRequest`), `invoker` (`"public"` makes it callable without IAM auth — required because the browser calls it; access control happens in our code), `timeoutSeconds` (HTTP functions **up to 3600 s**), `memory`, `cpu`, `concurrency` (default 80), `minInstances`, `maxInstances`, `secrets`, `serviceAccount`, `ingressSettings`, `labels`.

Genesis settings:

| Function   | timeout   | memory  | concurrency | min/max instances               | secrets                                                                         |
| ---------- | --------- | ------- | ----------- | ------------------------------- | ------------------------------------------------------------------------------- |
| `api`      | 60 s      | 512 MiB | 80          | 0 (1 during review window) / 10 | `HL_CLIENT_ID`, `HL_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`                      |
| `generate` | **540 s** | 1 GiB   | 20          | 0 (1 during review window) / 5  | `ANTHROPIC_API_KEY`, `HL_CLIENT_ID`, `HL_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` |

The default timeout (60 s) would kill a generation mid-stream — `generate` **must** set `timeoutSeconds` explicitly.

**Request body:** the Functions runtime pre-parses JSON into `req.body` and exposes the unparsed bytes as **`req.rawBody`** (Buffer). Do not mount `express.json()` again.

**URLs:** 2nd-gen functions answer on `https://<region>-<projectId>.cloudfunctions.net/<functionName>` (and a `*.run.app` URL). Genesis documents the `cloudfunctions.net` form as the "Cloud Functions base URL".

## 4. Streaming (SSE) — what works where

| Path                                              | Streams?                                                                  | Timeout                                                       | Verdict                                                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser → **function URL** (2nd gen / Cloud Run)  | **Yes** — Cloud Run supports HTTP response streaming / server-sent events | function `timeoutSeconds`                                     | **Use this for `/generate`**                                                                                                                              |
| Browser → **Firebase Hosting rewrite** → function | **No** — Hosting buffers responses (and may cache them at the CDN)        | **Hard 60 s**, 504 after that, regardless of function timeout | Never for SSE; we avoid rewrites for the API entirely to keep one CORS model                                                                              |
| Functions **emulator**                            | Streams locally                                                           | —                                                             | Works for development, but emulator behavior has historically differed from production (firebase-tools #3175); **deploy a streaming smoke test on Day 1** |
| 1st-gen functions                                 | Buffered                                                                  | —                                                             | Not used                                                                                                                                                  |

Server rules for reliable SSE on Cloud Run:

- Headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-store, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`; call `res.flushHeaders()` immediately.
- **No compression** middleware on the streaming route.
- Send an event or comment at least every 15 s so intermediaries do not drop an idle connection.
- Respect backpressure: if `res.write()` returns `false`, await `drain`.

## 5. What happens when the client disconnects

Cloud Run's default CPU allocation is **request-based**: CPU is allocated while a request is in flight and throttled to near zero once the response completes. When the browser disconnects, the connection to the container closes, `req`'s `close` event fires, and continuing heavy work in that request is unreliable (it can crawl or stall). Work that must survive the request needs a durable handoff (for example Cloud Tasks) — out of scope for five days.

**Consequences for Genesis:**

1. On `req.on('close')` before completion: **abort the LLM stream immediately** (stop paying for tokens) and finalize the generation as `interrupted`, keeping already-validated files **staged** (not applied).
2. Finalization is a handful of Firestore writes; a **heartbeat/lease** on the generation (`heartbeatAt` every 15 s) lets any later request detect a generation whose instance died and treat it as `interrupted` (stale after 60 s).
3. "Resume a running generation after reload" is listed as a "would improve" (durable job + event log), not promised.

## 6. Configuration, parameters and secrets

| Mechanism                                                                                                                                                   | Use in Genesis                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defineSecret('NAME')` + `secrets: [...]` on the function + `.value()` at runtime                                                                           | `ANTHROPIC_API_KEY`, `HL_CLIENT_ID`, `HL_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` (stored in **Cloud Secret Manager**)                                              |
| `defineString` / `defineInt` / `defineList` params, values from `functions/.env`, `functions/.env.<projectId>`, `functions/.env.local` (emulator overrides) | Non-secret config: `APP_BASE_URL`, `ALLOWED_ORIGINS`, `HL_REDIRECT_URI`, `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT`, `LLM_PROVIDER`, caps                              |
| `functions/.secret.local`                                                                                                                                   | Emulator-only secret overrides (never committed)                                                                                                                  |
| Set secrets                                                                                                                                                 | `firebase functions:secrets:set ANTHROPIC_API_KEY` (prompts for the value; creates a Secret Manager version)                                                      |
| Access                                                                                                                                                      | Secret values are available **only at runtime inside functions that declare them** — never at module load/deploy time. Build dependencies lazily on first request |

Firebase **service account**: Cloud Functions use Application Default Credentials; no JSON key is needed at runtime. CI deploys authenticate via Workload Identity Federation or a service-account key stored as a GitHub secret (never in the repo).

## 7. Emulator Suite

| Emulator  | Port | Notes                                                           |
| --------- | ---- | --------------------------------------------------------------- |
| Auth      | 9099 | `connectAuthEmulator(auth, 'http://127.0.0.1:9099')`            |
| Firestore | 8080 | `connectFirestoreEmulator(db, '127.0.0.1', 8080)`; **Java 21+** |
| Functions | 5001 | URLs `http://127.0.0.1:5001/<projectId>/us-central1/<fn>`       |
| Hosting   | 5000 | Optional (Vite dev server is used during development)           |
| UI        | 4000 | Inspect data, auth users, logs                                  |

Commands: `firebase emulators:start --import ./.emulator-data --export-on-exit`; tests use `firebase emulators:exec --only firestore,auth "<test command>"`. The functions emulator uses the **host** Node version; keep it equal to the deployed runtime (24).

## 8. Firestore facts we design around

| Limit / behavior                 | Value                                                                               | Design impact                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Max document size                | 1 MiB                                                                               | File content capped at 100 KB; snapshot = small manifest + content-addressed blobs         |
| Writes per transaction / batch   | 500 operations                                                                      | A commit writes ≤ ~60 docs                                                                 |
| Transaction request size         | ~10 MiB                                                                             | Commit payload ≤ ~1 MB                                                                     |
| Sustained writes to one document | ~1 per second                                                                       | Never stream tokens into Firestore; heartbeat every 15 s is fine                           |
| Admin SDK transactions           | Pessimistic locking; callback may **retry**                                         | **Never perform external side effects (HTTP token refresh) inside a transaction callback** |
| Rules `get()` / `exists()`       | ≤ 10 per single-document request                                                    | Project-create rule uses 2                                                                 |
| TTL policies                     | Delete docs after a timestamp field passes (asynchronously, typically within ~24 h) | `oauthStates` gets `expiresAt` TTL; code still checks expiry                               |
| Location                         | Chosen once, **immutable**                                                          | `nam5` (US multi-region), co-located with `us-central1` functions                          |
| Composite indexes                | Needed for equality + order on different fields                                     | `projects: status ASC, updatedAt DESC`                                                     |

Rules patterns used: path-scoped ownership (`request.auth.uid == uid`), `request.resource.data.keys().hasOnly([...])`, `diff(resource.data).affectedKeys().hasOnly([...])`, `request.time` equality for server timestamps, `get()` of a server-written projection document, and **deny-all** for server-only collections.

## 9. Firebase Authentication (web)

- `getAuth()` defaults to **`browserLocalPersistence`** (IndexedDB): sessions survive refresh and browser restarts — satisfies R-AUTH2 with no code.
- `await auth.authStateReady()` resolves once the initial state is known — use it in the router guard to avoid redirect flicker.
- ID tokens last **1 hour**; `user.getIdToken()` refreshes automatically when needed. Fetch a fresh token right before each API/SSE call.
- Enable the **Email/Password** provider in the console; add the Hosting domains to **Authorized domains** (added automatically for `web.app` / `firebaseapp.com`).

## 10. Hosting

- `public: "frontend/dist"`, SPA rewrite `** → /index.html`.
- Cache: `/assets/**` → `public, max-age=31536000, immutable`; `index.html` → `no-cache`.
- Security headers via `firebase.json` `headers`: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy` (camera/mic/geolocation off), `Strict-Transport-Security`. CSP starts as `Content-Security-Policy-Report-Only` and is promoted after verification (Monaco workers, Firebase endpoints and the function origin must be allowed).
- No API rewrites (see §4).

## 11. Billing and project setup

- **Blaze (pay-as-you-go) plan is required** to deploy Cloud Functions, to make outbound calls (Anthropic, HighLevel), and to use Secret Manager. Add a **budget alert** (for example USD 25).
- Enabling happens implicitly on first deploy (Cloud Functions, Cloud Build, Artifact Registry, Cloud Run, Eventarc, Secret Manager APIs).
- Organization policies on some Google Workspace-owned projects block `allUsers` invokers ("Domain restricted sharing"); a personal Google account project avoids this.
- **Project ID** must not contain "highlevel"/"ghl"/"leadconnector" (HighLevel redirect-URI validator, `research/02` §2.5).

## 12. Cost envelope (demo scale)

| Item                                                                                   | Estimate                             |
| -------------------------------------------------------------------------------------- | ------------------------------------ |
| Functions (a few hundred invocations, `minInstances: 1` on two functions for ~2 weeks) | ~USD 5–15                            |
| Firestore reads/writes                                                                 | Free tier / cents                    |
| Secret Manager                                                                         | Cents                                |
| Hosting                                                                                | Free tier                            |
| **Anthropic**                                                                          | Dominant cost — see `research/04` §7 |

Set `minInstances` back to 0 after the review window.
