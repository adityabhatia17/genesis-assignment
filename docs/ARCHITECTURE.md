# Genesis — Locked Architecture & Implementation Plan

**Status: LOCKED.** This document is the single source of truth for implementation. It supersedes
`GENESIS_ARCHITECTURE.md` (the earlier draft) and the exploratory system-design canvases that
preceded it. Every open question raised during design review has a final answer in Section 3.
Nothing below is provisional — implement exactly this unless reality (an API behaving differently
than documented, a genuine blocker) forces a change, in which case update this file first, then
the code.

Target: HighLevel take-home, **Genesis — AI-Powered HighLevel App Builder**, 5-day window.

---

## 1. Product Summary

A signed-in user connects one HighLevel location via OAuth, creates a project, describes an app
in chat, watches it get generated file-by-file in real time, sees it run in a live preview against
**real HighLevel Contacts/Conversations/Calendars data**, edits it manually, and can restore any
earlier generation from a snapshot.

The one idea that shapes every other decision in this document:

```
The LLM is an untrusted code producer.
It never holds a HighLevel token, an LLM key, or a Firebase Admin credential.
Generated code talks only to our own backend, which alone holds real credentials.
```

---

## 2. Non-Negotiable Trust Boundaries

These are not up for revision during implementation:

1. The browser never calls Anthropic directly. Only the `/api/generate` Cloud Function holds the
   Anthropic API key.
2. Generated code (the app running inside the preview iframe) never receives a HighLevel access
   token, refresh token, or client secret — in any form, at any point.
3. The HighLevel OAuth token document in Firestore is unreadable and unwritable by any client
   under any security rule. Only Cloud Functions (Admin SDK) touch it.
4. Every privileged Cloud Function derives `uid` from a verified Firebase ID token. Never from a
   request body field.
5. Every request that references a `projectId` re-verifies ownership server-side before doing
   anything privileged with it.
6. There is no generic `POST /proxy { url }` endpoint. HighLevel is reachable only through a
   small, explicit, allow-listed set of runtime routes.

---

## 3. Locked Decisions

Every decision that was open, debated, or flagged during design review. Each is final.

| # | Decision | Choice (LOCKED) | Why |
|---|---|---|---|
| 1 | OAuth install level | Direct **location-level** install (one Firebase user → one HighLevel location) | Matches the assignment's own scope exactly; skips the agency→location token-exchange hop that only matters for agency-distributed apps. |
| 2 | LLM provider | **Anthropic Claude**, Messages API, `stream: true` | Assignment allows Claude or OpenAI; Claude is the one we've deep-researched (streaming semantics, rate limits). Pick one and commit — building both wastes a day for no benefit at this scale. |
| 3 | LLM output protocol | **Plain-text, marker-delimited file format** (Section 11.1) — not JSON tool-calling | Tool-calling only streams one full input key at a time and JSON-escapes file content, which kills live character-by-character streaming into the editor and adds escaping bugs. A rare, collision-resistant text marker streams naturally as raw `text_delta` chunks (officially safe to relay live) while every file is still independently validated after parsing — we don't lose safety, we gain smooth streaming and a simpler API call (no tool schema, no `tool_choice`). |
| 4 | SSE transport | Authenticated `fetch()` + manual SSE frame parsing, hitting the Cloud Function URL **directly** (not through the Firebase Hosting rewrite) | `EventSource` cannot send an `Authorization` header or a POST body; Firebase Hosting rewrites buffer streaming responses, which breaks SSE. |
| 5 | Live preview sandbox | `<iframe srcdoc>` with `sandbox="allow-scripts"` only (no `allow-same-origin`) | Generated apps are small HTML/CSS/JS widgets that call our proxy — not bundled JSX apps. Sandpack/WebContainers would solve a bundling problem this assignment doesn't have. |
| 6 | HighLevel token exposure | Generated code calls `window.genesis.highlevel.*`, which calls our same-origin runtime proxy; the proxy attaches the real token server-side | Non-negotiable (Section 2). |
| 7 | Firestore tenancy model | **Path-based nesting**: `users/{uid}/projects/{projectId}/...` | A security rule scoped to a path prefix can't be defeated by a forgotten `where` filter in a query written later; field-based `ownerId` checks also cost an extra `get()` per rule evaluation that path nesting avoids. |
| 8 | HighLevel token storage security | Stored as plain fields in a Firestore document with a hard `allow read, write: if false` rule (Admin SDK only). **No application-level encryption in v1.** | Firestore already encrypts at rest; a deny-all rule plus Admin-SDK-only access is a real, sufficient boundary for this assignment's threat model. Custom envelope encryption is listed as a "would improve" item, not v1 scope. |
| 9 | Firebase environment strategy | **One Firebase project.** Local development uses the Firebase Local Emulator Suite. | A second dev/prod project doubles OAuth redirect registration and secrets for a solo, graded, 5-day build with no real multi-environment risk. |
| 10 | HighLevel OAuth scopes | `contacts.readonly`, `calendars.readonly`, `calendars/events.readonly`, `conversations.readonly`, `conversations/message.readonly` — **read-only, nothing else** | Matches the assignment's own example prompts, which are all read-only. Least privilege; write scopes are added later only if a specific feature needs them. |
| 11 | Refresh-token concurrency | Refresh happens under a **per-`locationId` Firestore transaction/lock** | HighLevel rotates the refresh token on every use; two concurrent refresh calls for the same location can invalidate each other. |
| 12 | HighLevel pagination | Normalized into **one cursor contract** (`{ items, nextCursor, hasMore }`) inside the backend adapter | HighLevel uses three different pagination shapes across Contacts/Conversations/Calendars; the LLM-facing capability surface and the frontend should never see that inconsistency. |
| 13 | Runtime proxy shape | Explicit **per-resource REST routes** (`/api/hl/contacts`, `/api/hl/calendars`, …), never a generic dispatch proxy | A generic proxy defeats the entire security boundary — it would let generated code request anything. |
| 14 | Snapshot strategy | **Full-copy snapshot** of all files after every successful generation | Project sizes are small; full copies make restore trivial to implement and to demo. A delta/Git-style chain adds real complexity for no benefit at this scale. |
| 15 | Frontend state boundaries | Firestore = durable data. Pinia = ephemeral workspace UI state only (active tab, open tabs, streaming buffer, panel widths). | Avoids a second, driftable copy of the source of truth. |
| 16 | Model provider abstraction | A thin `ModelProvider` interface exists; **only `AnthropicProvider` is implemented** | Keeps a future provider swap cheap without spending a day building an OpenAI path nobody needs for this submission. |
| 17 | CI/CD | **Manual deploy.** No GitHub Actions pipeline is required for this assignment. | Five days is better spent on the product than on pipeline plumbing. Mention manual deployment steps in the README instead. |
| 18 | Testing scope | **Mandatory:** Firestore rules tests + a small deterministic golden-prompt eval harness. **Optional (if time remains):** a handful of unit tests on the riskiest modules (file validator, token manager). **Not required:** E2E suite, CI pipeline. | Matches what the assignment actually asks for and what a reviewer can verify quickly; the eval harness is cheap to build and is a genuine senior-level differentiator. |
| 19 | Documentation | **This file** (`docs/ARCHITECTURE.md`) is the only internal architecture document, plus the assignment-mandated root `README.md`. No separate `GENERATION_PROTOCOL.md` / `FIRESTORE_MODEL.md` / `SECURITY.md` suite. | A four-file doc suite for a 5-day build is itself a scope-discipline problem; one file, kept accurate, is more useful than five files that drift. |
| 20 | Repo structure | `/frontend`, `/functions`, `firebase.json`, `.firebaserc`, `.env.example`, `firestore.rules`, `docs/ARCHITECTURE.md`, `README.md` at root. **No `/shared` npm workspace package.** | Cross-package type sharing via an npm workspace adds real build/tooling overhead for a handful of shared interfaces. Instead: define contracts once in `functions/src/contracts/`, and hand-mirror the same shapes in `frontend/src/types/generation.ts` with a comment pointing at the source of truth. Explicit, small, documented duplication beats monorepo tooling at this scale. |
| 21 | File operations from generation | **Create-or-overwrite by path only.** No LLM-driven file deletion in v1. | Nothing in the assignment requires the AI to delete files; adding a delete operation is untested surface area for no required benefit. |
| 22 | Iterative refinement (bonus) | Reuses the exact same `/api/generate` pipeline. Context always includes full current file contents; the model is instructed to emit only the files that need to change. Files it doesn't emit are left untouched. | No new endpoint, no new protocol — refinement is just "generate again with more context," which the pipeline already supports. |
| 23 | Diff view (bonus) | Computed **on demand, client-side**, comparing two already-fetched snapshots with the `diff` npm package. Nothing is pre-computed or stored. | Simplest implementation; snapshots are small enough that client-side diffing is instant. |
| 24 | Storage for file content | **Firestore only.** No Firebase Storage / Cloud Storage bucket. | Generated files are small text (HTML/CSS/JS), well within Firestore document limits; adding a second storage system buys nothing here. |

---

## 4. High-Level Architecture

```
 ┌───────────────────────────────── BROWSER TAB ─────────────────────────────────┐
 │                                                                                │
 │   Vue 3 SPA                              Generated App Preview                │
 │   Chat · Monaco editor ·                 <iframe srcdoc                      │
 │   Snapshot sheet                         sandbox="allow-scripts">             │
 │                                           window.genesis.highlevel.*          │
 └──────────────┬───────────────────────────────────────┬───────────────────────┘
                │ Firebase ID token                      │ fetch (no HL token)
                ▼                                        ▼
 ┌─────────────────────────────── CLOUD FUNCTIONS (2nd gen) ─────────────────────┐
 │  Client-direct (no function needed, enforced by Firestore rules):             │
 │    project CRUD · file manual save · message/snapshot reads                  │
 │                                                                                │
 │  /api/hl/oauth/start        /api/hl/oauth/callback                           │
 │  /api/generate  (SSE)       /api/generate/:id/cancel                        │
 │  /api/hl/contacts   /api/hl/calendars   /api/hl/calendars/:id/appointments   │
 │  /api/hl/conversations   /api/hl/conversations/:id/messages                  │
 │  /api/projects/:id/snapshots/:id/restore                                     │
 └───────┬───────────────────────────┬──────────────────────────┬──────────────┘
         │ Admin SDK, uid-scoped     │ stream: true              │ Bearer location token
         ▼                           ▼                           ▼
 ┌───────────────┐         ┌─────────────────────┐      ┌──────────────────────────┐
 │   Firestore    │         │  Anthropic Claude    │      │      HighLevel API        │
 │ users/{uid}/…  │         │  Messages API        │      │ services.leadconnectorhq  │
 │ hlConnection   │         │  stream:true         │      │ .com — Contacts,          │
 │ (server-only)  │         │  (text streaming)     │      │ Conversations, Calendars  │
 └───────────────┘         └─────────────────────┘      └──────────────────────────┘
```

---

## 5. Tech Stack (final)

| Concern | Choice |
|---|---|
| Frontend framework | Vue 3, Composition API, TypeScript |
| UI library | shadcn-vue (all interactive components) + Tailwind |
| Routing | Vue Router |
| Client workspace state | Pinia — ephemeral UI state only |
| Auth | Firebase Auth SDK, email/password |
| Persistent data | Firestore, client SDK for owner-scoped reads/writes, Admin SDK for privileged ops |
| Editor | Monaco via `@guolao/vue-monaco-editor` — one editor instance, one model per file |
| Generation transport | `fetch()` + hand-rolled SSE frame parser |
| Preview | `<iframe srcdoc>` |
| LLM | Anthropic Claude, Messages API, `stream: true` |
| Validation | Zod, both frontend and backend |
| Backend runtime | Firebase Cloud Functions v2, Node 20, Express for HTTP handlers |
| Deployment | Firebase Hosting (frontend) + Firebase Cloud Functions (backend) |
| Secrets | Firebase/Google Secret Manager |
| Diff (bonus) | `diff` npm package, client-side |

---

## 6. Repository Layout (final)

```
genesis/
├── frontend/
│   ├── src/
│   │   ├── app/                     # router, providers, App.vue
│   │   ├── components/ui/           # shadcn-vue generated components
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   ├── highlevel/           # connect button, connection badge
│   │   │   ├── projects/            # dashboard, project CRUD (direct Firestore)
│   │   │   ├── workspace/
│   │   │   │   ├── components/      # ChatPanel, CodePanel, PreviewPanel, WorkspaceHeader
│   │   │   │   ├── stores/          # workspace.store.ts (Pinia, ephemeral only)
│   │   │   │   ├── composables/     # useGeneration, useProjectFiles, usePreview
│   │   │   │   └── services/        # generation-stream.service.ts, preview-runtime.service.ts
│   │   │   └── snapshots/
│   │   ├── lib/                     # firebase.ts, errors.ts, env.ts
│   │   ├── types/                   # generation.ts — hand-mirrors functions/src/contracts
│   │   ├── pages/                   # LoginPage, RegisterPage, DashboardPage, WorkspacePage
│   │   └── main.ts
│   ├── vite.config.ts
│   └── package.json
│
├── functions/
│   ├── src/
│   │   ├── auth/                    # require-firebase-user.ts, ownership.ts
│   │   ├── highlevel/
│   │   │   ├── oauth/               # start.ts, callback.ts, state.repository.ts
│   │   │   ├── client/              # highlevel.client.ts, token-manager.ts, errors.ts
│   │   │   └── runtime/             # contacts.ts, calendars.ts, conversations.ts, router.ts
│   │   ├── generation/
│   │   │   ├── generate.controller.ts
│   │   │   ├── context-builder.ts
│   │   │   ├── system-prompt.ts
│   │   │   ├── stream-parser.ts     # the ⟦FILE⟧ marker scanner
│   │   │   ├── file-validator.ts
│   │   │   ├── project-committer.ts
│   │   │   └── model/
│   │   │       ├── model-provider.ts
│   │   │       └── anthropic-provider.ts
│   │   ├── snapshots/                # snapshot.service.ts, restore.controller.ts
│   │   ├── contracts/                # generation-events.ts, hl-runtime.ts — source of truth for shared types
│   │   ├── shared/                   # firestore helpers, http helpers, logging
│   │   └── index.ts
│   └── package.json
│
├── firestore.rules
├── firestore.indexes.json
├── firebase.json
├── .firebaserc
├── .env.example
├── docs/
│   └── ARCHITECTURE.md               # this file
└── README.md
```

---

## 7. Firestore Data Model (final)

All paths are nested under the owning user — this is the whole tenancy story; no field-based
ownership checks are needed anywhere.

```
/users/{uid}
    email, displayName, createdAt

/users/{uid}/hlConnection/default          — SERVER-ONLY, never client-readable
    locationId, locationName
    accessToken, refreshToken
    scope: string[]
    expiresAt: Timestamp
    status: 'connected' | 'reauth_required'
    connectedAt, updatedAt

/oauthStates/{stateHash}                   — SERVER-ONLY, short-lived
    uid, createdAt, expiresAt, consumed: boolean

/users/{uid}/projects/{projectId}
    name, description
    locationId                              (denormalized from hlConnection at creation time)
    status: 'active' | 'deleted'
    createdAt, updatedAt, deletedAt?
    currentGenerationId?, latestSnapshotId?

/users/{uid}/projects/{projectId}/files/{fileId}
    fileId = first 16 hex chars of sha256(normalizedPath)
    path, content, language, sizeBytes
    source: 'ai' | 'manual' | 'restore'
    version: number
    createdAt, updatedAt

/users/{uid}/projects/{projectId}/messages/{messageId}
    role: 'user' | 'assistant'
    content
    generationId?
    createdAt

/users/{uid}/projects/{projectId}/generations/{generationId}   — SERVER-ONLY (write); client can read
    clientRequestId                         (idempotency key)
    prompt
    promptVersion                           (GENERATION_PROMPT_VERSION from Section 11.1)
    status: 'queued'|'streaming'|'validating'|'committing'|'completed'|'cancelled'|'failed'
    model, startedAt, completedAt?
    filesChanged?: string[]
    errorCode?, errorMessage?
    baseSnapshotId?, resultSnapshotId?

/users/{uid}/projects/{projectId}/snapshots/{snapshotId}       — SERVER-ONLY (write); client can read
    generationId, createdAt, createdBy: 'generation'|'restore'
    fileCount, promptText

/users/{uid}/projects/{projectId}/snapshots/{snapshotId}/files/{fileId}  — SERVER-ONLY (write); client can read
    path, content, language
```

---

## 8. Firestore Security Rules (final, ready to paste)

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }

    function isOwner(uid) {
      return isSignedIn() && request.auth.uid == uid;
    }

    match /oauthStates/{stateHash} {
      allow read, write: if false; // Cloud Functions (Admin SDK) only
    }

    match /users/{uid} {
      allow read, update: if isOwner(uid);
      allow create: if isOwner(uid);

      match /hlConnection/{docId} {
        allow read, write: if false; // Cloud Functions (Admin SDK) only
      }

      match /projects/{projectId} {
        allow read, create, update: if isOwner(uid);
        allow delete: if false; // soft delete only, via update

        match /files/{fileId} {
          allow read, write: if isOwner(uid);
        }

        match /messages/{messageId} {
          allow read, write: if isOwner(uid);
        }

        match /generations/{generationId} {
          allow read: if isOwner(uid);
          allow write: if false; // Cloud Functions only
        }

        match /snapshots/{snapshotId} {
          allow read: if isOwner(uid);
          allow write: if false; // Cloud Functions only

          match /files/{fileId} {
            allow read: if isOwner(uid);
            allow write: if false;
          }
        }
      }
    }
  }
}
```

Mandatory rules tests (Firebase Emulator, `@firebase/rules-unit-testing`):

- User A can read/write their own project; user B is denied.
- `hlConnection` is denied to every client, including the owning user.
- `generations` and `snapshots` are client-readable but never client-writable.
- A client cannot set `ownerId`/escape their own `uid` path by crafting a request to another
  user's subtree (should be structurally impossible given path-based rules — write the test
  anyway to prove it).

---

## 9. HighLevel OAuth

### 9.1 Scopes (final — read-only)

```
contacts.readonly
calendars.readonly
calendars/events.readonly
conversations.readonly
conversations/message.readonly
```

Configure exactly these in the marketplace app's **Advanced Settings → Auth** screen. Do not add
write scopes unless a specific future feature needs them.

### 9.2 Flow

```
1. User clicks "Connect HighLevel".
2. Frontend calls POST /api/hl/oauth/start with the Firebase ID token.
3. Function verifies the token, generates a random state, stores
   { uid, expiresAt, consumed: false } at /oauthStates/{sha256(state)}, returns the
   HighLevel authorize URL (client_id, scopes, redirect_uri, state).
4. Browser redirects to HighLevel; user approves against the sandbox location.
5. HighLevel redirects to GET /api/hl/oauth/callback?code=...&state=...
6. Function looks up the state hash, rejects if missing/expired/already consumed, marks it
   consumed.
7. Function exchanges the code at
   POST https://services.leadconnectorhq.com/oauth/token
   { client_id, client_secret, grant_type: "authorization_code", code, user_type: "Location",
     redirect_uri }
8. Response gives access_token, refresh_token, expires_in, locationId. Function writes
   /users/{uid}/hlConnection/default with status: 'connected'.
9. Function redirects the browser to /dashboard?connected=1.
10. Frontend shows "Connected: <locationName>".
```

### 9.3 Token refresh (final)

```ts
async function getValidAccessToken(uid: string): Promise<string> {
  const conn = await loadConnection(uid);
  if (!conn) throw new AppError("HIGHLEVEL_NOT_CONNECTED");
  if (!isNearExpiry(conn.expiresAt)) return conn.accessToken;
  return refreshUnderLock(uid, conn);
}

async function refreshUnderLock(uid: string, conn: HlConnection): Promise<string> {
  // Firestore transaction on /users/{uid}/hlConnection/default:
  // re-read inside the transaction; if another request already refreshed
  // (expiresAt moved forward since we loaded conn), return the new token
  // instead of refreshing again. HighLevel rotates the refresh token on
  // every use, so a second concurrent refresh with the now-stale token
  // would fail with "this refresh token is invalid".
  return runTransaction(async (tx) => {
    const fresh = await tx.get(connRef);
    if (fresh.data().expiresAt > conn.expiresAt) return fresh.data().accessToken;
    const result = await exchangeRefreshToken(fresh.data().refreshToken);
    tx.update(connRef, {
      accessToken: result.access_token,
      refreshToken: result.refresh_token, // rotated — must overwrite
      expiresAt: nowPlus(result.expires_in),
      status: "connected",
      updatedAt: serverTimestamp(),
    });
    return result.access_token;
  });
}
```

If refresh fails with an authorization error (`401`, `invalid grant`), set
`status: 'reauth_required'` and surface "HighLevel connection expired — reconnect" in the UI.

---

## 10. HighLevel Runtime Proxy (final endpoint list)

All routes: verify Firebase ID token → verify project ownership → load the project's
`locationId` → `getValidAccessToken(uid)` → call HighLevel → normalize response → return JSON.
Never accept a `locationId` from the request; it always comes from the owned project.

| Route | HighLevel call it wraps | Returns |
|---|---|---|
| `GET /api/hl/contacts?query=&cursor=&limit=` | `POST /contacts/search` | `{ items: Contact[], nextCursor?, hasMore }` |
| `GET /api/hl/calendars` | `GET /calendars/` | `{ items: Calendar[] }` |
| `GET /api/hl/calendars/:calendarId/appointments?from=&to=` | `GET /calendars/events` | `{ items: Appointment[] }` |
| `GET /api/hl/conversations?cursor=&limit=` | `GET /conversations/search` | `{ items: Conversation[], nextCursor?, hasMore }` |
| `GET /api/hl/conversations/:conversationId/messages?cursor=&limit=` | `GET /conversations/:id/messages` | `{ items: Message[], nextCursor?, hasMore }` |

Pagination normalization: HighLevel uses `startAfter/startAfterId` (contacts),
`lastMessageId` (conversation messages), and date-range windowing (calendar events) — the
adapter converts each into the same `{ items, nextCursor, hasMore }` shape.

The adapter also flattens each HighLevel payload into the item fields named in the system
prompt (Section 11.1). Raw HighLevel objects are not returned. `limit` defaults to 20 and is
capped at 50. `calendars.appointments` takes ISO-8601 `from` / `to` and rejects a window longer
than 31 days; the adapter converts those timestamps to the epoch milliseconds HighLevel expects.
Bump `GENERATION_PROMPT_VERSION` in the same change whenever those fields change.

Runtime SDK injected into the preview iframe maps 1:1 onto this table:

```ts
window.genesis = {
  highlevel: {
    contacts: { list: (input) => fetch(...) },
    calendars: {
      list: () => fetch(...),
      appointments: (input) => fetch(...),
    },
    conversations: {
      list: (input) => fetch(...),
      messages: (input) => fetch(...),
    },
  },
};
```

Each call carries the Firebase ID token (available inside the iframe via a `postMessage`
handshake with the parent SPA at load time, not via cookies/localStorage) so the proxy can
authenticate it exactly like any other privileged call.

---

## 11. Generation Pipeline (final)

### 11.1 System prompt (final)

`GENERATION_PROMPT_VERSION = "1"`. Persist that string on every generation document.
`buildSystemPrompt` concatenates the static prompt below with the current-files block.
The static prompt is verbatim — do not paraphrase it in code. The model never sees this
architecture document, so the prompt is the whole contract it gets.

Static prompt:

```
You are the code generator inside Genesis, a HighLevel app builder. You write a small browser app that the product previews live. You do not run the app, and you do not call HighLevel yourself.

The latest user message is the request. Earlier messages are the conversation so far. CURRENT PROJECT FILES, appended after these instructions, is what is saved right now.

# Files you may write

Exactly these three, and no others:

- index.html, lang="html"
- styles.css, lang="css"
- app.js, lang="javascript"

Plain HTML, CSS, and JavaScript. No bundler, no npm, no ES modules, no import, no export, no TypeScript, no JSX. No remote resources: no https:// URLs, no CDN scripts, no web fonts, no @import of a remote stylesheet.

The preview compiles the three files into one document. It inlines styles.css where index.html has <link rel="stylesheet" href="styles.css">, and it runs app.js where index.html has <script src="app.js"></script>. Before app.js runs, the preview injects window.genesis. Do not assign to window.genesis or replace window.genesis.highlevel.

index.html is a complete document: <!DOCTYPE html>, <html lang="en">, <meta charset="utf-8">, a viewport meta tag, a <title>, the stylesheet link in <head>, and <script src="app.js"></script> at the end of <body>. The script tag has no type attribute.

# HighLevel runtime

This is the entire HighLevel API available to the app. Do not invent methods, URLs, headers, query parameters, or tokens.

window.genesis.highlevel.contacts.list({ query?, cursor?, limit? })
window.genesis.highlevel.calendars.list()
window.genesis.highlevel.calendars.appointments({ calendarId, from, to })
window.genesis.highlevel.conversations.list({ cursor?, limit? })
window.genesis.highlevel.conversations.messages({ conversationId, cursor?, limit? })

Every method returns a Promise. On failure it throws an Error. Show error.message to the user.

contacts.list, conversations.list, and conversations.messages resolve to:
{ items: array, nextCursor: string | null, hasMore: boolean }

calendars.list resolves to { items: array }.
calendars.appointments resolves to { items: array }.

limit is an integer from 1 to 50. Omit it to use 20.
cursor is the nextCursor from the previous page of that same method. Omit it for the first page.
query is an optional search string for contacts.
calendarId and conversationId are required. Take them from a previous list result. Never invent an id.
from and to are ISO-8601 timestamps. One appointments call covers at most 31 days. For a longer range, call it again with the next window.

Contact:
{ id, name, firstName, lastName, email, phone, tags, dateAdded }
name is always a non-empty display string. Other strings may be empty. tags is an array of strings. dateAdded is ISO-8601 or empty.

Calendar:
{ id, name }

Appointment:
{ id, title, calendarId, startTime, endTime, status, contactName }
startTime and endTime are ISO-8601.

Conversation:
{ id, contactName, lastMessage, lastMessageAt, unreadCount }
lastMessageAt is ISO-8601 or empty. unreadCount is a number.

Message:
{ id, body, direction, dateAdded }
direction is "inbound" or "outbound". dateAdded is ISO-8601 or empty.

Read only these fields.

# How the app behaves

Call HighLevel only through window.genesis.highlevel. Do not call fetch, XMLHttpRequest, WebSocket, or EventSource.
Do not touch localStorage, sessionStorage, indexedDB, document.cookie, or window.parent. The preview sandbox blocks them.
Every HighLevel call has a loading state, an empty state, and an error state that shows the thrown message.
Render the items that were returned. Do not invent rows, names, times, or ids. Chrome copy may be written by you; records may not.
When a string field is empty, show a dash.
Format ISO-8601 timestamps for a person.
When hasMore is true, offer a control that loads the next page by passing nextCursor as cursor.
To show appointments, call calendars.list() first, then appointments() with a returned calendarId.
To show messages, call conversations.list() first, then messages() with a returned conversationId.
Use real buttons and inputs, associated labels, and visible text on controls.

# Security

Never request, embed, print, log, or simulate a credential, API key, access token, refresh token, client secret, or Authorization header. Never write leadconnectorhq.com. Never ask the user to paste a token.

# Output format

Write one or two plain sentences about what you are building or changing. Then emit files. Write nothing after the last closing marker.

Frame every file exactly like this. The opening marker is a single line. path comes before lang. Both values use double quotes. There are no other attributes. The markers use the characters ⟦ (U+27E6) and ⟧ (U+27E7). Do not substitute brackets, XML, or markdown fences.

⟦FILE path="index.html" lang="html"⟧
...raw file text...
⟦/FILE⟧

lang is html, css, or javascript, matching the path above.
Do not indent the markers. Do not wrap the file in a code fence. Do not place the character sequences ⟦FILE or ⟦/FILE⟧ inside file content.
When CURRENT PROJECT FILES says there are no saved files, emit all three, in this order: index.html, styles.css, app.js.
When files already exist, emit only files whose text must change. A file you do not emit stays as it is. You cannot delete a file. A file cannot be empty.
Finish every file you open. Keep each file well under 250 KB.
```

Current-files block, appended by `renderCurrentFiles(projectName, files)`:

When `files` is empty:

```
CURRENT PROJECT FILES
Project: <project name>
No files are saved yet. Emit index.html, styles.css, and app.js.
```

When `files` is not empty, list only saved paths, in the order `index.html`, `styles.css`, `app.js`, skipping any of the three that are absent:

```
CURRENT PROJECT FILES
Project: <project name>
These files are saved. They are the source of truth. Apply the latest user message. Emit only files that must change.

===== FILE index.html =====
<exact file text>
===== END =====
```

The `=====` sentinels are not output syntax. The model emits `⟦FILE⟧` markers only. Do not put `locationId`, tokens, or chat history into this block — chat history is the `messages` array (Section 11.2).

### 11.2 Request

```ts
export const GENERATION_PROMPT_VERSION = "1";

function buildSystemPrompt(projectName: string, currentFiles: { path: string; content: string }[]) {
  return `${STATIC_SYSTEM_PROMPT}\n\n${renderCurrentFiles(projectName, currentFiles)}`;
}

const stream = anthropic.messages.stream({
  model: ANTHROPIC_MODEL, // pin the exact model string in functions/src/config — confirm current name in Anthropic's docs at implementation time
  system: buildSystemPrompt(project.name, currentFiles),
  messages: [...lastNMessages(12), { role: "user", content: prompt }],
  stream: true,
  // no `tools` array — plain text streaming only (Decision #3)
});
```

Context bounding (final, no further nuance needed at this project scale): last 12 chat messages
+ full content of every current project file (assignment-scale projects are a handful of small
files — no summarization layer is needed).

### 11.3 Streaming loop — the ⟦FILE⟧ marker scanner

```ts
const START = /⟦FILE path="([^"]+)" lang="([^"]+)"⟧/;
const END = "⟦/FILE⟧";

let buffer = "";
let current: { path: string; lang: string } | null = null;
let flushed = 0;

for await (const event of stream) {
  if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") continue;
  buffer += event.delta.text;

  if (!current) {
    const m = buffer.match(START);
    if (m) {
      current = { path: m[1], lang: m[2] };
      sse.send("file.started", { path: current.path, language: current.lang });
      buffer = buffer.slice(m.index! + m[0].length);
      flushed = 0;
    } else {
      // prose outside a file block — goes to the chat panel
      sse.send("assistant.token", { text: event.delta.text });
    }
    continue;
  }

  const endIdx = buffer.indexOf(END);
  if (endIdx === -1) {
    const newText = buffer.slice(flushed);
    if (newText) sse.send("file.chunk", { path: current.path, text: newText });
    flushed = buffer.length;
    continue;
  }

  const content = buffer.slice(0, endIdx);
  const result = validateFile({ path: current.path, language: current.lang, content });
  if (result.ok) {
    await persistFile(uid, projectId, result.file);
    sse.send("file.completed", { path: result.file.path, sizeBytes: result.file.content.length });
  } else {
    sse.send("generation.error", { path: current.path, code: result.code, message: result.message, retryable: false });
    // continue processing the rest of the stream — one bad file doesn't kill the generation
  }
  buffer = buffer.slice(endIdx + END.length);
  current = null;
  flushed = 0;
}

if (current) {
  // stream ended mid-file (e.g. stop_reason: max_tokens) — do not persist a truncated file
  sse.send("generation.error", { path: current.path, code: "TRUNCATED", message: "Generation ended before this file finished.", retryable: true });
}

await commitSnapshot(uid, projectId, generationId);
sse.send("generation.completed", { generationId, snapshotId, changedFiles });
```

The trust boundary this loop enforces: **matching the marker format is never sufficient on its
own.** `validateFile` runs regardless of how cleanly the markers parsed.

### 11.4 File validation (`validateFile`, final rules)

Reject:
- Path contains `..`, starts with `/`, or contains a drive letter (`C:\`).
- Path is not exactly one of `index.html`, `styles.css`, `app.js` (extend this allow-list
  deliberately later; do not open it up by default).
- Content is empty, or exceeds 250 KB.
- Total project size (all files combined) exceeds 1 MB.
- Content contains the literal substring `leadconnectorhq.com` or any string matching a bearer
  token pattern — a cheap belt-and-braces check against the model accidentally fabricating or
  echoing a credential-shaped string.

### 11.5 Commit & snapshot

Files are persisted one at a time, at each `file.completed` — not batched at the very end. This
is what makes "partial results preserved" true even if the stream dies: whatever files finished
validating are already in Firestore. At the very end (or on graceful stream completion), create a
snapshot document copying the current file set, and write the assistant's chat message
(the prose collected via `assistant.token`).

### 11.6 SSE event protocol (final)

```
generation.started      { generationId }
assistant.token         { text }
file.started            { path, language }
file.chunk              { path, text }
file.completed          { path, sizeBytes }
generation.validating   { }
generation.committing   { }
generation.completed    { generationId, snapshotId, changedFiles: string[] }
generation.cancelled    { generationId }
generation.error        { generationId?, path?, code, message, retryable: boolean }
heartbeat               { }               — every 15s, keeps the connection alive
```

Wire format:

```
event: file.started
data: {"path":"app.js","language":"js"}

event: file.chunk
data: {"path":"app.js","text":"const contacts = await genesis"}

event: file.completed
data: {"path":"app.js","sizeBytes":2048}
```

### 11.7 Reconnection & idempotency (final)

`clientRequestId` (a UUID generated by the frontend per submit) is written onto the generation
document before the model is called. If the same `clientRequestId` arrives twice (e.g. the
frontend retries after a network blip), the function returns the existing generation instead of
starting a new model call. If the SSE connection drops mid-stream, the frontend does **not**
auto-resubmit; it calls `GET /api/generate/:id` for status:

```
completed → reload files from Firestore
failed    → show failure, offer retry (new prompt/new clientRequestId)
running   → show "stream interrupted — generation still processing", poll status
```

### 11.8 Cancellation (bonus, final)

`POST /api/generate/:id/cancel` sets `status: 'cancelling'` on the generation document. The
streaming loop checks this flag on every buffer iteration; on seeing it, it aborts the Anthropic
stream, keeps whatever files already persisted, sets `status: 'cancelled'`, and sends
`generation.cancelled`. The frontend also fires its own `AbortController` on the fetch for
immediate UI feedback independent of the backend's confirmation.

### 11.9 Iterative refinement (bonus, final)

No new endpoint. The second (and every subsequent) prompt goes through the exact same
`/api/generate` pipeline. Context always includes full current file content (11.2), and the
system prompt already instructs "emit only files you are creating or changing." Nothing else
changes.

---

## 12. Frontend Architecture (final)

### 12.1 Routes

```
/            → redirect to /dashboard or /login
/login
/register
/dashboard
/projects/:projectId     (the three-panel workspace)
```

Route meta `{ requiresAuth: true }` on everything except `/login` and `/register`. Guard waits
for Firebase auth to initialize before deciding.

### 12.2 Workspace layout

```
WorkspacePage
├── WorkspaceHeader — project name, HL connection badge, snapshot button
└── ResizableWorkspace
    ├── ChatPanel — message list, generation status, prompt textarea, Generate/Cancel button
    ├── CodePanel — file tree, editor tabs, MonacoEditor (one instance, one model per file)
    └── PreviewPanel — toolbar, error boundary, sandboxed iframe
```

During an active generation: prompt input becomes a Cancel button, Monaco is read-only, the file
currently streaming becomes the active tab, other files remain inspectable, and the preview
stays on its last successful build. After a successful commit: file tree refreshes, editor
unlocks, preview reloads, snapshot becomes visible in the history sheet.

### 12.3 State boundaries (final, no exceptions)

| State | Lives in |
|---|---|
| Project files, messages, snapshots, generation status | Firestore (subscribed via listeners) |
| Currently selected tab, open tabs, panel widths, live streaming buffer | Pinia (`workspace.store.ts`) |
| Unsaved Monaco edit before Save is clicked | Local component state only |

### 12.4 Manual file editing

```
edit in Monaco → local dirty state → click Save → Firestore update
  (only if version == expectedVersion, else show "file changed, reload") → version++ → preview refresh
```

Preview refresh happens **only** on: explicit Save, `generation.completed`, or restore
completion — never on every keystroke.

---

## 13. Live Preview (final)

Compile `index.html + styles.css + app.js` into one `srcdoc` string, with
`window.genesis.highlevel.*` injected before `app.js` runs. Render:

```html
<iframe sandbox="allow-scripts" :srcdoc="compiledPreview" />
```

Never add `allow-same-origin`. The sandbox has no access to the SPA's cookies, localStorage, or
parent DOM — this is what makes it safe to run LLM-authored code at all.

---

## 14. Snapshots & Restore (final)

Restore is a privileged Cloud Function (`POST /api/projects/:id/snapshots/:id/restore`):

```
verify Firebase user → verify project ownership → verify snapshot belongs to project
  → create a "before restore" safety snapshot of current files
  → replace active files with the snapshot's files
  → update project metadata (latestSnapshotId)
  → return the restored revision
```

The pre-restore safety snapshot means a restore can never be a destructive, unrecoverable
mistake.

---

## 15. Error Handling (final, mapped to the assignment's explicit requirements)

| Failure | Handling |
|---|---|
| Malformed LLM output (one file fails validation) | `generation.error` scoped to that file; the rest of the generation continues; already-valid files are kept. |
| Stream cut off mid-file (`max_tokens` or disconnect) | That file is discarded (not persisted half-written); already-completed files remain. Generation marked `failed`, error surfaced. |
| Client disconnects mid-stream | Frontend queries generation status on reconnect (11.7); no duplicate model call. |
| HighLevel API call fails (rate limit, expired token, location inactive) | Normalized error code returned to the generated app / preview (`Unable to load contacts. Reconnect HighLevel or try again.`); token refresh attempted once on `401` before surfacing an error. |
| User resubmits after a failure | `clientRequestId` idempotency prevents a duplicate paid model call. |

Domain error codes (final):

```ts
type ErrorCode =
  | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'PROJECT_NOT_FOUND'
  | 'HIGHLEVEL_NOT_CONNECTED' | 'HIGHLEVEL_REAUTH_REQUIRED' | 'HIGHLEVEL_RATE_LIMITED' | 'HIGHLEVEL_API_ERROR'
  | 'GENERATION_INVALID_OUTPUT' | 'GENERATION_CANCELLED' | 'GENERATION_STREAM_INTERRUPTED'
  | 'SNAPSHOT_NOT_FOUND' | 'INTERNAL';
```

Never return a stack trace, a token, or a raw provider error body to the client.

---

## 16. Rate Limiting (bonus, final — implement after the core path works)

Firestore fixed-window counter document per `uid` per operation, checked at the top of each
privileged function:

```
generation:   10 / 10 minutes / user
runtime proxy: 60 / minute / user
oauth start:    5 / minute / user
```

On exceeding, return `HIGHLEVEL_RATE_LIMITED` or a `429` with a clear message. Log HighLevel's
own `X-RateLimit-*` response headers when present.

---

## 17. Bonus Feature Priority (final order)

Implement in this order, on Day 5, stopping wherever time runs out:

1. Generation cancellation (Section 11.8) — cheap, high perceived polish.
2. Firestore rules tests + eval harness (technically "testing," but treat as equal priority to
   bonuses since it's the strongest differentiator per unit of effort).
3. Diff view (Section 3, decision 23).
4. Rate limiting (Section 16).
5. Pagination is already built into the runtime proxy by default (Section 10) — nothing extra
   needed here beyond verifying it with a >20-contact sandbox dataset if time allows.
6. Webhook support — **do not start this** unless everything above is done and stable. It is the
   lowest-value bonus per the assignment's own wording.

---

## 18. Testing (final, trimmed)

**Mandatory:**
- Firestore rules tests (Section 8's four cases, via the Emulator Suite).
- A deterministic eval harness at `functions/tests/evals/`: 5 golden prompts (e.g. "Build a
  recent contacts dashboard.", "Show upcoming calendar appointments.") run against a fake or real
  `ModelProvider`, asserting: required files exist, no forbidden strings (bearer tokens, raw
  HighLevel URLs), only `window.genesis.highlevel.*` is used, output stays under file/size
  limits.

**Optional, only if time remains on Day 5:**
- Unit tests for `TokenManager.getValidAccessToken` (expiry, refresh, lock) and
  `validateFile` (path traversal, size limits).

**Not required for this assignment:** CI pipeline, E2E suite, cross-browser testing.

---

## 19. What We Are Explicitly Not Building

- Kubernetes, custom microservices, Redis, custom auth.
- JSON tool-calling for LLM output (Decision #3) — plain-text marker protocol instead.
- Application-level token encryption beyond Firestore's own at-rest encryption + deny-all rules
  (Decision #8) — a "would improve" item.
- A second Firebase project for dev/prod (Decision #9).
- A second LLM provider implementation (Decision #2, #16).
- A `/shared` npm workspace package (Decision #20).
- A GitHub Actions CI/CD pipeline (Decision #17).
- LLM-driven file deletion (Decision #21).
- Context summarization for large projects — not needed at this project's scale.
- A full E2E test suite.
- Sandpack or WebContainers for the preview (Decision #5).
- A generic HTTP proxy endpoint (Decision #13, Section 2 item 6).
- Webhook support, unless every other item is already done (Section 17).
- `contacts.write` / `conversations/message.write` OAuth scopes (Decision #10).
- Multi-location-per-user data modeling (Decision #1).
- A separate four-file documentation suite — this file is it (Decision #19).

---

## 20. 5-Day Implementation Plan (final)

**Day 1 — Foundation, Auth, Projects**
Firebase project + emulators; Vue 3 + Vite + TS + Tailwind + shadcn-vue scaffold; Firebase Auth
(signup/signin/signout) + route guard; Firestore rules (Section 8) + rules tests passing; project
CRUD as direct client Firestore calls (no Cloud Function needed); dashboard page.
*Success: signup → dashboard → create project → empty workspace loads.*

**Day 2 — HighLevel OAuth + Runtime Proxy**
OAuth start/callback functions (Section 9); token refresh with lock; connection badge; all five
runtime proxy routes (Section 10) with pagination normalization.
*Success: Connect HighLevel → a manual test call returns real sandbox contacts and appointments.*

**Day 3 — LLM Generation + SSE**
System prompt (11.1); `/api/generate` with the marker-scanning streaming loop (11.3), validation
(11.4), per-file persistence (11.5); frontend SSE client; chat panel wired to `assistant.token`;
Monaco wired to `file.started`/`file.chunk`/`file.completed`, read-only while streaming.
*Success: prompt → visible live streaming in chat and editor → files saved → snapshot created.*

**Day 4 — Workspace, Preview, Snapshots**
Three-panel resizable workspace; file tree + tabs; manual edit/Save path with version check;
`srcdoc` preview compiler + injected runtime SDK; preview refresh rules (12.4); snapshot history
sheet + restore endpoint (Section 14).
*Success: the full happy path — prompt → real HighLevel data in preview → manual edit → restore
— works reliably end to end.*

**Day 5 — Hardening, Bonuses, Delivery**
Fix happy-path bugs → error/empty/loading states everywhere → rules tests + eval harness →
bonuses in the Section 17 order → deploy Hosting + Functions → register the production OAuth
redirect URI in the marketplace app → write the README (Section 21) → record the Loom (Section
22) → **paste the Loom link into both the README and the submission email.**

---

## 21. README Content (final, pre-written — fill in URLs at delivery time)

### Architecture decisions (max 10, per the assignment)

1. Generated code never receives the HighLevel OAuth token; it calls a same-origin
   `window.genesis.highlevel` runtime SDK backed by an explicit, per-resource Cloud Functions
   proxy that holds and refreshes the token server-side.
2. HighLevel OAuth uses a direct location-level install — one Firebase user, one HighLevel
   location — matching the assignment's scope exactly.
3. LLM output uses a plain-text, collision-resistant file-delimiter format rather than JSON
   tool-calling, so file content streams live into the editor with no JSON-escaping artifacts,
   while every parsed file is still independently validated before being trusted.
4. Firestore is modeled with path-based multi-tenancy (`users/{uid}/projects/{id}/...`) so a
   security rule scopes an entire subtree by path segment rather than relying on a field check a
   future query could bypass.
5. Generation output is staged and validated file-by-file before the active project is touched,
   so a failed or interrupted generation never corrupts the user's last-working app.
6. Simple, owner-scoped CRUD goes straight through Firestore security rules from the client;
   Cloud Functions exist only where a secret, an external API call, or a privileged
   multi-document operation is required.
7. Generation streams over authenticated `fetch()` with manual SSE parsing rather than
   `EventSource`, because the endpoint needs a POST body, a Firebase ID token header, and
   cancellation support.
8. Each successful generation writes a full-copy snapshot rather than a delta chain, because
   project sizes are small and a full copy makes restore trivial to reason about and demo.
9. HighLevel's three different pagination shapes are normalized into one cursor contract inside
   the backend adapter, so neither the LLM nor the frontend ever sees the underlying
   inconsistency.
10. Refresh-token rotation is serialized per HighLevel location with a lock, because HighLevel
    invalidates the previous refresh token on every use and concurrent refreshes would otherwise
    race.

### What I would improve with more time (max 5)

1. Move HighLevel token storage from "protected purely by security rules" to
   application-level envelope encryption via Cloud KMS, for defense in depth.
2. Add a durable generation job model so a client can reconnect to an in-progress generation
   after a page reload or a function cold start, instead of only checking final status.
3. Expand the deterministic golden-prompt eval harness with semantic/model-graded scoring and a
   regression baseline over time.
4. Support multiple HighLevel locations per user instead of the current one-location-per-user
   constraint.
5. Replace full-copy snapshots with content-addressed, delta-based storage once project sizes
   grow beyond a small demo.

---

## 22. Loom Script (final, under 5 minutes)

```
0:00–0:30  Deployed URL, sign in, dashboard, HL connection status.
0:30–1:05  Connect HighLevel. Mention: tokens are server-only, scoped to this user/location.
1:05–1:25  Create project. Prompt: "Build a contact dashboard with search and a list of
           upcoming appointments."
1:25–2:15  Streamed response — chat prose, then files appearing in Monaco in real time.
2:15–2:55  Preview: point out these are real HighLevel sandbox contacts/appointments.
2:55–3:30  Open app.js, show genesis.highlevel.contacts.list(...); explain the proxy boundary
           as the one architectural decision worth highlighting.
3:30–4:00  Edit a file manually, save, show the preview update.
4:00–4:30  Open snapshot history, restore an earlier snapshot, show the preview revert.
4:30–5:00  Close on: "Generated code never receives the OAuth token — that's the boundary this
           whole system is built around."
```

Paste the resulting link into the README **and** the submission email — the assignment asks for
both explicitly.

---

## 23. Definition of Done (final)

**Auth:** signup, login, session persists across refresh, protected routing, sign out.

**HighLevel:** OAuth state validated and single-use; callback exchanges code; access token never
sent to the browser; refresh works under lock; Contacts/Conversations/Calendars proxy routes all
return real sandbox data.

**Projects:** create, list, rename, soft delete; cross-user reads denied by rules test.

**Generation:** prompt persisted; model called server-side only; stream visible in real time;
malformed file rejected without failing the whole generation; interrupted stream preserves
already-completed files; successful generation commits and creates a snapshot; assistant message
persisted.

**Editor:** file tree, tabs, Monaco, manual save with version check, read-only during active
generation.

**Preview:** sandboxed iframe, runtime SDK injected, real Contacts and Calendar data rendered,
HighLevel token unreachable from inside the iframe (verify by trying to read it in the browser
console from within the iframe context), preview updates only after commit.

**Snapshots:** created after every successful generation, history visible, restore works and
creates a pre-restore safety snapshot.

**Deployment:** Hosting live, Functions live, redirect URI updated in the HighLevel marketplace
app to the deployed function URL, `.env.example` present, no secrets in git, README complete,
Loom link in both the README and the submission email.
