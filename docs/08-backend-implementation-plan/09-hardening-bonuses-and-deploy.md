# BE-8 — Production deploy

> Read [`00-overview.md`](00-overview.md) first. Design: [`../05-backend-system-design.md`](../05-backend-system-design.md) §10–§11; research: [`../research/02-highlevel-platform.md`](../research/02-highlevel-platform.md) §8, [`../research/04-llm-generation.md`](../research/04-llm-generation.md) §5, §11. Delivery mechanics: [`../10-delivery-git-and-deployment.md`](../10-delivery-git-and-deployment.md).

Tasks BE-8.1–8.5 are out of v1. **Always finish BE-8.6.**

---

### Task BE-8.1: Rate limits — verification and wiring audit (R-B4)

Assignment bonus R-B4 (Cloud Function rate limits) is **out of v1**. Skip this task. HighLevel `429` retry and `HL_RATE_LIMITED` stay in the HTTP client (BE-4.1). Host-bridge budgets stay on the SPA (FE-6.3).

### Task BE-8.2: Kill switch and global generation cap

Out of v1. Spend control is the Anthropic console monthly limit (prerequisites §4). Do not add `GENERATION_ENABLED` or `GENERATION_DAILY_GLOBAL_CAP`.

### Task BE-8.3 (bonus R-B6): Signed HighLevel webhooks → preview events

Assignment bonus R-B6 is **out of v1**. Do not add `hlWebhook`, `webhookEvents`, or `users/{uid}/events`.

### Task BE-8.4: Golden-prompt eval harness

Out of v1. Do not add `functions/evals/`.

### Task BE-8.5 (optional): Anthropic fast-mode fallback

Out of v1. Do not set `ANTHROPIC_FAST_MODE` or send `speed: 'fast'`.

### Task BE-8.6: Production deploy and smoke test

**Files:** none (runbook). Full delivery context: `10-delivery-git-and-deployment.md` §5–§6.

- [ ] **Step 1: Pre-flight (repo root)**

```bash
npm run contracts:check
npm run lint && npm run typecheck && npm test
npm run test:rules && npm run test:integration
gitleaks detect --no-banner   # or: git log -p | grep -E "sk-ant-|BEGIN (RSA )?PRIVATE" → must print nothing
```

- [ ] **Step 2: Production params** — `functions/.env.genesis-builder-7f3a` has production values (APP_BASE_URL = Hosting URL, ALLOWED_ORIGINS = Hosting origins only (+ localhost if you still develop against prod), HL_REDIRECT_URI = prod callback, `LLM_PROVIDER=anthropic`, `SSE_SMOKE_ENABLED=false`, `API_MIN_INSTANCES=1`, `GENERATE_MIN_INSTANCES=1` for the review window).

- [ ] **Step 3: Deploy backend**

```bash
firebase deploy --only firestore
firebase deploy --only functions
```
Expected: `api` and `generate` deployed on `nodejs24`; URLs printed.

- [ ] **Step 4: Register the redirect URI** in the HighLevel app (prerequisites §5.1) — exactly `https://us-central1-genesis-builder-7f3a.cloudfunctions.net/api/v1/hl/oauth/callback`.

- [ ] **Step 5: Smoke checklist (production)**

| # | Check | Expected |
|---|---|---|
| 1 | `curl …/api/v1/health` and `…/generate/v1/health` | `200 { ok: true }`, version = revision |
| 2 | `curl -i -X OPTIONS …/api/v1/hl/oauth/start -H "Origin: https://genesis-builder-7f3a.web.app" -H "Access-Control-Request-Method: POST"` | `204` + `access-control-allow-origin` = Hosting origin |
| 3 | Same with `Origin: https://evil.example` | no `access-control-allow-origin` |
| 4 | Connect HighLevel from the deployed SPA | Redirect back with `?hl=connected`; badge shows location name |
| 5 | Firestore console: `hlConnections/{uid}` | `accessToken.ct` is ciphertext; no plaintext tokens anywhere |
| 6 | Generate the Loom prompt | Live stream; snapshot #1; preview shows sandbox contacts + appointments |
| 7 | DevTools inside the preview iframe: `document.cookie`, `localStorage`, `fetch('https://example.com')` | Empty/shimmed; fetch blocked by CSP |
| 8 | Manual edit + save | Version bump; preview refreshes |
| 9 | Restore snapshot #1 | New restore snapshot; preview reverts |
| 10 | Cancel mid-stream; pull network mid-stream | `cancelled` / `interrupted` with Apply/Discard |
| 11 | Cloud Logging: filter `severity>=WARNING` | No unexpected errors; no tokens/prompts in logs |

- [ ] **Step 6: TTL policies and budget** — create the TTL policies (BE-2.2 Step 2) if not done; confirm the budget alert.

- [ ] **Step 7: Tag** — `git tag -a v1.0.0 -m "Genesis submission" && git push --tags` (after the frontend is deployed too; see `10` §6).
