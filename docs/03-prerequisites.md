# Genesis — Prerequisites (Day 0)

**Date:** 2026-09-26
**Goal:** Everything that must exist **before** the first line of code, so Day 1 starts with a working Firebase project, a HighLevel app + seeded sandbox, an Anthropic key and a verified local toolchain.
**Time budget:** ~2–3 hours (most of it is waiting on consoles and seeding data).

> Facts behind each step: `research/02` (HighLevel), `research/03` (Firebase), `research/04` (Claude), `research/05` (frontend stack).

---

## 0. "Day 0 done when…" checklist

- [ ] `node -v` → `v24.x`, `java -version` → `21` or newer, `firebase --version` → `15.x`
- [ ] Firebase project `genesis-builder-<suffix>` exists on **Blaze** with a budget alert; Firestore (Native, `nam5`) created; Email/Password auth enabled; a Web app registered
- [ ] `firebase login` done; `firebase projects:list` shows the project
- [ ] Anthropic API key created, **monthly spend limit** set, test call returns `200`
- [ ] HighLevel developer account + marketplace app (private, sub-account target) with the **6 read scopes**, redirect URI(s), **Client ID + Secret** saved in your password manager
- [ ] HighLevel **sandbox (App Test Account)** created, one sub-account ("Genesis Demo Clinic") seeded: ≥ 30 contacts, 2 calendars, 6–10 appointments in the next 14 days, ≥ 5 conversations
- [ ] Private Integration Token (PIT) for the sub-account created (local development only)
- [ ] `TOKEN_ENCRYPTION_KEY` generated and stored in your password manager
- [ ] GitHub repo created (public) — empty for now
- [ ] Spike list reviewed (§9) — you know what to verify on Day 1

---

## 1. Local toolchain (macOS)

| Tool                   | Version                                                                                | Install / verify                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js                | **24 LTS** (pinned in `.nvmrc`; do **not** change the nvm default used by other repos) | In this folder: `source scripts/genesis-env.sh` (`nvm use` from `.nvmrc`) → `node -v`                                                               |
| npm                    | 11.x (bundled with Node 24)                                                            | `npm -v`                                                                                                                                            |
| Java                   | **21+** for firebase-tools 15 emulators (global default can stay 17)                   | Project-only: JDK 21 under `.tools/jdk-21` or a side-by-side Temurin 21; `scripts/genesis-env.sh` sets `JAVA_HOME`. **Do not** add it to `~/.zshrc` |
| Firebase CLI           | 15.x (this repo, not a global `npm install -g`)                                        | After root `package.json` exists: `npx firebase-tools@15 --version`. `firebase login` still uses your Google account                                |
| Git + GitHub CLI       | git 2.50, gh 2.95 (installed)                                                          | `gh auth status`                                                                                                                                    |
| gcloud CLI (optional)  | latest                                                                                 | `brew install --cask google-cloud-sdk` — only for TTL policies from the terminal (console works too)                                                |
| cloudflared (optional) | latest                                                                                 | `brew install cloudflared` — only if HighLevel refuses a localhost redirect URI (spike S10)                                                         |
| Editor                 | VS Code + "Vue - Official" + ESLint + Prettier                                         | —                                                                                                                                                   |

```bash
source scripts/genesis-env.sh
node -v && npm -v && java -version && (firebase --version || npx firebase-tools@15 --version) && gh auth status
```

---

## 2. Accounts you need

| Account                                 | Why                                                                             | Notes                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Google account with billing             | Firebase **Blaze** plan (required for Functions, outbound HTTP, Secret Manager) | Use a **personal** Google account project; Workspace org policies can block public function invokers |
| Anthropic Console                       | `ANTHROPIC_API_KEY`                                                             | Set a **monthly spend limit** (e.g. USD 50)                                                          |
| HighLevel Marketplace developer account | App, Client ID/Secret, sandbox                                                  | `https://marketplace.gohighlevel.com`                                                                |
| GitHub                                  | Public repo, CI                                                                 | Enable secret scanning push protection (§8)                                                          |

---

## 3. Firebase project

### 3.1 Choose the project ID (important)

- Format: `genesis-builder-<4-6 random chars>`, e.g. `genesis-builder-7f3a`.
- **Must not contain** `highlevel`, `gohighlevel`, `leadconnector` or `ghl`: the project ID becomes part of the function hostname, and HighLevel rejects redirect URIs that contain a HighLevel reference.
- The ID is permanent.

### 3.2 Console steps

1. **Create project** at `console.firebase.google.com` → name "Genesis Builder" → the ID from §3.1 → Google Analytics **off** (not needed).
2. **Upgrade to Blaze** (Settings → Usage and billing) → add a **budget alert** (USD 25, email at 50/90/100 %).
3. **Firestore** → Create database → **Native mode** → location **`nam5` (United States)** → start in **production mode** (our rules replace the default).
4. **Authentication** → Get started → Sign-in method → **Email/Password: Enable** (leave "Email link" off). Settings → Authorized domains already include `<id>.web.app` and `<id>.firebaseapp.com`; `localhost` is present by default.
5. **Project settings → General → Your apps → Add app → Web** → nickname "genesis-web" → **also set up Firebase Hosting: yes** → copy the config object (apiKey, authDomain, projectId, appId, …). This config is **public by design**; it still goes in env files, not code.
6. **Hosting** → Get started (the CLI will do the rest on Day 1).

### 3.3 CLI

```bash
firebase login
firebase projects:list                      # the new project is listed
firebase apps:sdkconfig web --project genesis-builder-7f3a   # prints the web config
```

Region decisions (not configurable later without redeploying everything): **functions `us-central1`**, Firestore **`nam5`**. Both are in the US, close to HighLevel and Anthropic endpoints.

### 3.4 TTL policies (do after Day 1 deploy creates the collections, or now via console)

Console: Firestore → **Time-to-live** → Create policy:

| Collection group | Timestamp field |
| ---------------- | --------------- |
| `oauthStates`    | `expiresAt`     |

gcloud equivalent:

```bash
gcloud firestore fields ttls update expiresAt --collection-group=oauthStates --enable-ttl --project=genesis-builder-7f3a
```

TTL deletion is asynchronous (typically within ~24 h); code still checks `expiresAt`.

---

## 4. Anthropic

1. Console → API Keys → **Create key** "genesis-prod" (and optionally "genesis-dev").
2. Billing → **Limits** → monthly spend limit.
3. Verify model access (replace the key; expect `200` and a short answer):

```bash
curl -s https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-opus-5","max_tokens":64,"messages":[{"role":"user","content":"Say OK."}]}' | head -c 400
```

If you choose Sonnet 5 later (analysis Q1), repeat with `"model":"claude-sonnet-5"`.

---

## 5. HighLevel

### 5.1 Developer account and app

1. Sign up at `https://marketplace.gohighlevel.com` (developer account).
2. **My Apps → Create App**:
   - Name: **"Genesis Builder"** (do not put "HighLevel" in the name).
   - Distribution / type: **Private**.
   - Target user: **Sub-account** (location-level install).
3. App → **Advanced Settings → Auth**:
   - **Scopes** (exactly these 6):
     ```
     contacts.readonly
     conversations.readonly
     conversations/message.readonly
     calendars.readonly
     calendars/events.readonly
     locations.readonly
     ```
   - **Redirect URLs** (add all you will use; HighLevel accepts several):
     - Production: `https://us-central1-genesis-builder-7f3a.cloudfunctions.net/api/v1/hl/oauth/callback`
     - Local (spike S10): `http://127.0.0.1:5001/genesis-builder-7f3a/us-central1/api/v1/hl/oauth/callback`
     - Tunnel fallback (only if localhost is refused): `https://<random>.trycloudflare.com/genesis-builder-7f3a/us-central1/api/v1/hl/oauth/callback`
   - **Client Keys → Add** → copy **Client ID** and **Client Secret** into your password manager (the secret is shown once).
4. Save.

### 5.2 Sandbox ("App Test Account")

1. Developer portal → **Testing** → **+ Create App Test Account** → agency name "Genesis QA" + password → Create (provisioned immediately; lives ~6 months).
2. Log in to the sandbox agency → create **one sub-account**: "Genesis Demo Clinic", timezone e.g. `America/New_York` (sandboxes allow two sub-accounts).

### 5.3 Seed data (makes the preview and pagination convincing)

| Data          | How                                                                                                      | Target                                    |
| ------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Contacts      | Sub-account → Contacts → Import → CSV (generate below)                                                   | ≥ 30 (forces a second page at `limit=20`) |
| Tags          | Include a `Tags` column (`lead`, `vip`, `new-patient`)                                                   | Some contacts tagged                      |
| Calendars     | Calendars → Calendar Settings → New → "Consultations" and "Follow-ups"; set open hours Mon–Fri 9–17      | 2 calendars                               |
| Appointments  | Calendar view → add appointments linked to imported contacts across the **next 14 days**                 | 6–10                                      |
| Conversations | Open a contact → Conversations → send an email/SMS, or add inbound messages via API with the PIT (below) | ≥ 5 conversations, a few messages each    |

Generate the contacts CSV (fake, safe data):

```bash
node -e '
const first=["Ava","Liam","Mia","Noah","Zoe","Ethan","Ivy","Lucas","Aria","Mason","Nora","Leo","Ella","Owen","Luna"];
const last=["Patel","Garcia","Nguyen","Smith","Khan","Lopez","Brown","Kim","Silva","Ito"];
const tags=["lead","vip","new-patient",""];
const rows=["First Name,Last Name,Email,Phone,Tags"];
for(let i=0;i<36;i++){const f=first[i%first.length],l=last[(i*7)%last.length];
rows.push(`${f},${l},${f.toLowerCase()}.${l.toLowerCase()}${i}@example.com,+1555010${String(i).padStart(4,"0")},${tags[i%4]}`);}
require("fs").writeFileSync("genesis-demo-contacts.csv", rows.join("\n")); console.log("wrote genesis-demo-contacts.csv");'
```

### 5.4 Private Integration Token (local development only)

Sub-account → **Settings → Private Integrations → Create** → name "genesis-local" → select the same 6 read scopes (plus `calendars/events.write` and `conversations/message.write` only if you want to seed appointments or inbound messages by script) → copy the token into your password manager. It lets the emulator talk to real HighLevel data without an OAuth redirect (plan task BE-3.8). **Never commit it.**

Add inbound messages with the PIT (optional, for conversation seed data):

```bash
curl -s -X POST https://services.leadconnectorhq.com/conversations/messages/inbound \
  -H "Authorization: Bearer $HL_PIT" -H "Version: 2021-04-15" -H "Content-Type: application/json" \
  -d '{"type":"SMS","contactId":"<contactId>","message":"Hi, can I move my appointment to Friday?"}'
```

(If the sandbox rejects it, send messages from the UI instead.)

---

## 6. Secrets and configuration inventory

Every variable the system uses. **S** = secret (Secret Manager in prod, `functions/.secret.local` for the emulator). **P** = non-secret param (`functions/.env.<projectId>` / `.env.local`). **F** = frontend build-time (`frontend/.env.local` / `.env.production`, public by nature).

| Name                                             | Kind       | Example                                                                                                                         | Used by                                           |
| ------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `ANTHROPIC_API_KEY`                              | S          | `sk-ant-…`                                                                                                                      | `generate`                                        |
| `HL_CLIENT_ID`                                   | S          | `66f…-abc`                                                                                                                      | `api`, `generate`                                 |
| `HL_CLIENT_SECRET`                               | S          | `…`                                                                                                                             | `api`, `generate`                                 |
| `TOKEN_ENCRYPTION_KEY`                           | S          | 32 random bytes, base64                                                                                                         | `api`, `generate`                                 |
| `APP_BASE_URL`                                   | P          | `https://genesis-builder-7f3a.web.app`                                                                                          | OAuth callback redirect target                    |
| `ALLOWED_ORIGINS`                                | P          | `https://genesis-builder-7f3a.web.app,https://genesis-builder-7f3a.firebaseapp.com,http://localhost:5173,http://127.0.0.1:5173` | CORS                                              |
| `HL_REDIRECT_URI`                                | P          | `https://us-central1-genesis-builder-7f3a.cloudfunctions.net/api/v1/hl/oauth/callback`                                          | OAuth                                             |
| `HL_SCOPES`                                      | P          | the 6 read scopes, space-separated                                                                                              | OAuth                                             |
| `ANTHROPIC_MODEL`                                | P          | `claude-opus-5`                                                                                                                 | `generate`                                        |
| `ANTHROPIC_EFFORT`                               | P          | `medium`                                                                                                                        | `generate`                                        |
| `LLM_PROVIDER`                                   | P          | `anthropic` (`fake` locally without a key)                                                                                      | `generate`                                        |
| `VITE_FIREBASE_API_KEY` … `VITE_FIREBASE_APP_ID` | F          | from `apps:sdkconfig`                                                                                                           | SPA                                               |
| `VITE_API_BASE_URL`                              | F          | `https://us-central1-genesis-builder-7f3a.cloudfunctions.net/api`                                                               | SPA                                               |
| `VITE_GENERATE_BASE_URL`                         | F          | `https://us-central1-genesis-builder-7f3a.cloudfunctions.net/generate`                                                          | SPA                                               |
| `VITE_USE_EMULATORS`                             | F          | `false` (true locally)                                                                                                          | SPA                                               |
| `HL_PIT`                                         | local only | `pit-…`                                                                                                                         | `scripts/seed-pit-connection.ts` (never deployed) |

Generate the encryption key:

```bash
openssl rand -base64 32
```

Set production secrets (after `firebase use genesis-builder-7f3a` on Day 1; each command prompts for the value):

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase functions:secrets:set HL_CLIENT_ID
firebase functions:secrets:set HL_CLIENT_SECRET
firebase functions:secrets:set TOKEN_ENCRYPTION_KEY
firebase functions:secrets:access HL_CLIENT_ID     # sanity check (prints the value)
```

Rotating a secret: `secrets:set` again → redeploy the functions that use it. Rotating `TOKEN_ENCRYPTION_KEY` invalidates stored tokens (users reconnect) — acceptable for v1; key versioning is in the data model for a future dual-key rotation.

---

## 7. Reviewer demo account (after the Day 4 deploy)

1. On the **deployed** app, sign up `reviewer.genesis@<your-domain>` with a strong password.
2. Connect HighLevel to the sandbox sub-account.
3. Create project "Demo — Contacts & Appointments" and run the Loom prompt once.
4. Put the credentials **only** in the submission email (never in the repo).

---

## 8. GitHub

1. `gh repo create genesis --public --description "Genesis — AI-powered HighLevel app builder"` (Day 1, after `git init`; see `10-delivery-git-and-deployment.md`).
2. Settings → Code security → **Secret scanning** + **Push protection**: enable.
3. Branch protection on `main` (require CI green) once CI exists.

---

## 9. Day-1 spikes (know them now)

Run on Day 1 morning, before writing adapters. Details and fallbacks: `research/02` §12.

| #       | Spike                                                    | Pass condition                                   |
| ------- | -------------------------------------------------------- | ------------------------------------------------ |
| S1      | OAuth authorize with `state`                             | Callback receives the same `state`               |
| S2      | Code exchange (form-encoded, `user_type=Location`)       | `200` with `locationId` + `refresh_token`        |
| S3 / S4 | Refresh twice; reuse an old refresh token                | Rotation works; record the error body for reuse  |
| S5      | Contacts `searchAfter` pagination                        | Page 2 ≠ page 1                                  |
| S6      | Messages response shape                                  | Record nested vs flat                            |
| S7      | Conversations cursor                                     | Page 2 ≠ page 1                                  |
| S8      | Calendar events with epoch ms                            | Events returned                                  |
| S9      | `GET /locations/{id}`                                    | Name + timezone                                  |
| S10     | Localhost redirect accepted                              | Save succeeds (else tunnel/PIT)                  |
| S11     | (optional) Send message in sandbox — familiarize only    | Success or recorded error                        |
| S12     | **Deployed** 2nd-gen function streams SSE to the browser | Events arrive incrementally (not all at the end) |

The OAuth spikes (S1–S4) are easiest with a throwaway script (`functions/scripts/spike-oauth.ts`, plan task BE-3.5 notes) or with curl:

```bash
# After approving in the browser and copying ?code=… from the callback URL:
curl -s -X POST https://services.leadconnectorhq.com/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "client_id=$HL_CLIENT_ID" \
  --data-urlencode "client_secret=$HL_CLIENT_SECRET" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=$CODE" \
  --data-urlencode "user_type=Location" \
  --data-urlencode "redirect_uri=$HL_REDIRECT_URI" | jq 'del(.access_token, .refresh_token)'
```

Never paste real tokens into chat tools, tickets or commits; scrub fixtures (plan task BE-4.7 provides the recorder that scrubs them).
