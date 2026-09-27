# Research 02 — HighLevel platform facts for Genesis

**Date:** 2026-09-26
**Sources:** HighLevel's public docs repo `GoHighLevel/highlevel-api-docs` (OpenAPI specs under `apps/*.json`, guides under `docs/oauth/*`, cloned at commit `0af86a4`), `marketplace.gohighlevel.com/docs`, HighLevel help center, Make community thread on redirect-URI validation, official `ghl-marketplace-app-template`. Items marked **VERIFY** must be confirmed against the sandbox on Day 1 (spike list in §12).
**Purpose:** One place for every HighLevel fact the backend depends on, so implementation never guesses.

---

## 1. Accounts, apps, sandbox

| Fact                             | Detail                                                                                                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Developer portal                 | `https://marketplace.gohighlevel.com` → sign up → **My Apps → Create App** → configure scopes, redirect URLs, client keys under the app's settings (Advanced Settings → Auth)                                     |
| Sandbox ("App Test Account")     | Developer portal → **Testing** (top nav) → **+ Create App Test Account** → agency name + password → provisioned immediately                                                                                       |
| Sandbox lifetime                 | Active for **up to 6 months** from creation; may be deactivated after, reactivation on request                                                                                                                    |
| Sandbox features                 | Trial access to Enterprise features; supports marketplace apps (private or public), Private Integration Tokens, webhooks at low volume                                                                            |
| Sub-accounts per sandbox         | Help-center sources state **2 sub-accounts per sandbox** (the official sandbox page does not list the number) — create one for Genesis, keep one spare                                                            |
| Private Integration Tokens (PIT) | Sub-account-scoped static tokens with selectable scopes (Settings → Private Integrations). Useful for **local development** to seed a connection without the OAuth round trip                                     |
| Official app template            | `GoHighLevel/ghl-marketplace-app-template` — Express + Vue 3; OAuth callback route `/authorize-handler`; SSO decrypt route `/decrypt-sso`; webhook route example. Confirms Vue is HighLevel's own front-end idiom |

## 2. OAuth 2.0 (Authorization Code grant)

### 2.1 Authorization URL

HighLevel documents a template (not a fixed URL). Current docs use the **`/v2/`** path:

```
https://marketplace.gohighlevel.com/v2/oauth/chooselocation
  ?response_type=code
  &redirect_uri=<url-encoded redirect URI>
  &client_id=<CLIENT_ID>
  &scope=<space-separated scopes, url-encoded>
  &state=<opaque CSRF value>            (standard OAuth; see §2.6)
  &loginWindowOpenMode=self             (optional: log in in the same tab instead of a new tab)
```

White-label variant: `https://marketplace.leadconnectorhq.com/v2/oauth/chooselocation` (same parameters). We use the standard host.

The user picks a sub-account; HighLevel redirects to `redirect_uri?code=<code>[&state=<state>]`.

### 2.2 Token endpoint

- `POST https://services.leadconnectorhq.com/oauth/token`
- **`Content-Type: application/x-www-form-urlencoded`** (OpenAPI `GetAccessCodebodyDto` — only form encoding is declared). Sending JSON is the most common integration mistake.
- Body for code exchange: `client_id`, `client_secret`, `grant_type=authorization_code`, `code`, `user_type=Location`, `redirect_uri`.
- Body for refresh: `client_id`, `client_secret`, `grant_type=refresh_token`, `refresh_token`, `user_type=Location`, `redirect_uri`.
- Required by schema: `client_id`, `client_secret`, `grant_type`.

Response (`GetAccessCodeSuccessfulResponseDto`):

| Field                                                                                                  | Notes                                                        |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `access_token`                                                                                         | Bearer token                                                 |
| `token_type`                                                                                           | `"Bearer"`                                                   |
| `expires_in`                                                                                           | `86399` in examples (~24 h)                                  |
| `refresh_token`                                                                                        | Rotated on every refresh                                     |
| `scope`                                                                                                | Space-separated granted scopes                               |
| `userType`                                                                                             | `"Location"` for sub-account tokens                          |
| `locationId`                                                                                           | Present only for sub-account tokens                          |
| `companyId`, `userId`                                                                                  | Agency ID and installing user ID                             |
| `planId`, `isBulkInstallation`, `approvedLocations`, `installToFutureLocations`, `approveAllLocations` | Agency/bulk-install fields — we reject non-`Location` tokens |

**There is no location name in the response.** Showing "Connected: <location name>" requires `GET /locations/{locationId}` with the `locations.readonly` scope (§4).

### 2.3 Lifetimes and rotation

- Access tokens are valid for **about one day**.
- Refresh tokens are valid for **one year or until used**. Using a refresh token **invalidates it** and returns a new one that must replace the old one in storage.
- Consequence: two concurrent refreshes with the same refresh token → the second fails and a naive implementation marks the connection broken. Refresh must be **single-flight per user across all function instances** (lease lock, `05-backend-system-design.md` §7.3).

### 2.4 Token-expiry handling guidance (HighLevel FAQ)

Call the API; on an "expired token" response, refresh, save **both** new tokens, retry. We do this reactively (one retry on 401) **and** proactively (refresh when < 5 minutes of validity remain).

### 2.5 Redirect URI validation

HighLevel rejects redirect URIs that contain a HighLevel reference. Observed error text: _"The redirect uri contains a Highlevel reference. Please remove any Highlevel references to save."_ The report involved a white-label app and the substring `highlevel`.

Rules we adopt:

1. Callback path: **`/v1/hl/oauth/callback`** — never `highlevel`, `gohighlevel`, `leadconnector` or `ghl` in the path.
2. The **Firebase project ID must not contain those substrings either**, because it appears in the function hostname (`us-central1-<projectId>.cloudfunctions.net`).
3. Multiple redirect URIs can be registered (production + local/tunnel).

### 2.6 `state` parameter

The docs do not mention `state`. Standard OAuth clients that require a state round-trip (for example n8n's HighLevel OAuth2 credential) work against HighLevel, which indicates the value is echoed. **VERIFY** on Day 1. Fallback if it were dropped: bind the flow with a short-lived, `SameSite=Lax` cookie set on a top-level navigation to the functions domain.

Our state design: 32 random bytes (base64url); only its SHA-256 is stored (`oauthStates/{sha256}` with `uid`, `expiresAt` = now + 10 min, `consumedAt`); consumed exactly once inside a transaction. The user identity at callback comes **from the state record**, never from the browser.

### 2.7 Uninstall

HighLevel sends an `UNINSTALL` webhook (`{ type: "UNINSTALL", appId, locationId }` for location-level uninstalls) to the app's webhook URL. Without the webhook we still detect revocation because refresh fails; the connection then moves to `reauth_required`.

---

## 3. API conventions

| Convention                      | Value                                                                                                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL                        | `https://services.leadconnectorhq.com`                                                                                                                                                                               |
| Auth header                     | `Authorization: Bearer <access_token>`                                                                                                                                                                               |
| **`Version` header (required)** | Contacts & Locations: **`2021-07-28`**. Calendars & Conversations: **`2021-04-15`**. Wrong or missing `Version` is a common 4xx cause                                                                                |
| Response metadata               | Every response carries a `traceId` (log it on errors)                                                                                                                                                                |
| Newer "v3" family               | HighLevel is publishing v3 specs (`Version: v3`, `/v3` route prefix, "AIP-compliant responses"). **Decision: stay on the documented v2 dated versions** behind an adapter layer so a v3 migration touches one module |

---

## 4. Scopes Genesis requests (6)

Genesis OAuth and the runtime proxy request **read scopes only**. Create/update/send/availability appear in HighLevel's API and in the assignment's "familiarize yourself" list; they are not product methods.

| Scope                            | Enables                                                | Runtime methods                                                                   |
| -------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `contacts.readonly`              | `POST /contacts/search`, `GET /contacts/{id}`          | `contacts.list`, `contacts.get`                                                   |
| `conversations.readonly`         | `GET /conversations/search`, `GET /conversations/{id}` | `conversations.list`                                                              |
| `conversations/message.readonly` | `GET /conversations/{id}/messages`                     | `conversations.messages`                                                          |
| `calendars.readonly`             | `GET /calendars/`, `GET /calendars/{id}`               | `calendars.list`                                                                  |
| `calendars/events.readonly`      | `GET /calendars/events`                                | `calendars.events`                                                                |
| `locations.readonly`             | `GET /locations/{locationId}`                          | Location name/timezone for the dashboard badge and prompt context; `location.get` |

Not requested: `contacts.write`, `conversations/message.write` (write/send are familiarize-only), `conversations.write`, `calendars/events.write` (booking is not in What to Build), `locations/*`, `users.*`, agency scopes. A Private Integration Token used only to **seed** the sandbox may add write scopes for import scripts; production OAuth does not.

---

## 5. Endpoint catalogue

All paths are relative to the base URL. `locationId` always comes from the stored connection, never from the caller. **Genesis adapters implement the read endpoints.** Create/update/send/free-slots are documented here as HighLevel platform facts (assignment "familiarize" verbs and sandbox seeding); they are not runtime methods.

All paths are relative to the base URL. `locationId` always comes from the stored connection, never from the caller.

### 5.1 Contacts (`Version: 2021-07-28`)

**Search — `POST /contacts/search`** (the list/search endpoint; `GET /contacts/` is **deprecated**)

Request body (the OpenAPI schema is empty and points to an external doc; the fields below are the documented/observed ones — **VERIFY** against the sandbox):

```json
{
  "locationId": "<from connection>",
  "pageLimit": 20,
  "query": "optional free text",
  "searchAfter": [1712345678901, "contactIdOfLastRow"],
  "sort": [{ "field": "dateAdded", "direction": "desc" }]
}
```

- Cursor pagination uses **`searchAfter`** (an array taken from the last row of the previous page). A common bug is sending `startAfter`, which is silently ignored and returns page 1 again.
- Page-number pagination (`page` + `pageLimit`) also exists but is capped for deep pages; we use `searchAfter` only.
- Response: `{ contacts: [...], total: number }`. Each contact includes `searchAfter` (array) when sorting is applied — **VERIFY** the exact field name; fall back to `[last.dateAdded(ms), last.id]` if absent.
- Contact fields seen in `ContactsSearchSchema`: `id, locationId, email, timezone, country, source, dateAdded, customFields, tags, businessId, attributions, followers`, plus `firstName`, `lastName`, `contactName`, `phone`, `companyName` in practice.

**Get — `GET /contacts/{contactId}`** → `{ contact: {...} }`

**Create — `POST /contacts/`** (scope `contacts.write`; **not a Genesis runtime method** — platform fact / sandbox seeding). Body requires `locationId`; optional `firstName, lastName, name, email, phone, companyName, tags, source, ...`. Duplicate-contact behavior depends on the location's "allow duplicate contacts" setting; a duplicate returns a 400 with a message we surface verbatim (sanitized). Response `{ contact }`.

**Update — `PUT /contacts/{contactId}`** (scope `contacts.write`). Partial body of the same fields. Response `{ contact }` (or `{ succeded, contact }` — **VERIFY**).

### 5.2 Conversations (`Version: 2021-04-15`)

**Search — `GET /conversations/search`**

| Query param             | Use                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `locationId` (required) | From connection                                                                                          |
| `limit`                 | Default 20                                                                                               |
| `query`                 | Free-text search                                                                                         |
| `contactId`             | Filter to one contact                                                                                    |
| `sort`                  | `asc` / `desc` (we send `desc`)                                                                          |
| `sortBy`                | `last_message_date` (default we send)                                                                    |
| `startAfterDate`        | "Search to begin after the specified date — should contain the sort value of the last document" → cursor |
| `status`                | `all`/`read`/`unread`/`starred`/`recents`                                                                |

Response: `{ conversations: ConversationSchema[], total }`. Documented fields: `id, contactId, locationId, lastMessageBody, lastMessageType, type, unreadCount, fullName, contactName, email, phone`. In practice rows also carry `lastMessageDate` (epoch ms) and a `sort` array. Cursor = `sort[0] ?? lastMessageDate` of the last row (**VERIFY**).

**Messages — `GET /conversations/{conversationId}/messages`** (scope `conversations/message.readonly`)

- Query: `lastMessageId` (cursor), `limit` (default 20), `type` (comma list).
- Documented response: `{ lastMessageId, nextPage: boolean, messages: GetMessageResponseDto[] }`. Many integrations observe it **nested** as `{ messages: { lastMessageId, nextPage, messages: [...] } }`. The adapter accepts both (**VERIFY** and record a fixture).
- Message fields: `id, type (number), messageType ("TYPE_SMS", "TYPE_EMAIL", …), locationId, contactId, conversationId, dateAdded, body, direction ("inbound"/"outbound"), status, contentType, attachments, source, userId`.

**Send — `POST /conversations/messages`** (scope `conversations/message.write`; **not a Genesis runtime method** — platform fact / sandbox seeding).

- Body: `{ type: "SMS" | "Email" | "WhatsApp" | …, contactId, message?, html?, subject?, emailTo?, ... }`. The schema marks `type, subType, contactId, status` required, which looks like a generator artifact; in practice `{ type, contactId, message }` sends an SMS. **VERIFY**.
- A sandbox without a configured phone number / email service will reject sends; the error must reach the UI clearly.
- Response: `{ conversationId, messageId, ... }`.

### 5.3 Calendars (`Version: 2021-04-15`)

**List — `GET /calendars/`** — query `locationId` (required), `groupId`, `showDrafted`. Response `{ calendars: CalendarDTO[] }` (fields include `id, name, description, isActive, calendarType, slotDuration, ...`).

**Events — `GET /calendars/events`**

| Query param                         | Notes                                         |
| ----------------------------------- | --------------------------------------------- |
| `locationId`                        | Required                                      |
| `startTime`, `endTime`              | **Required, epoch milliseconds** (as strings) |
| `calendarId` / `userId` / `groupId` | **One of the three is required**              |

Response `{ events: CalendarEventDTO[] }` with `id, title, calendarId, locationId, contactId, groupId, appointmentStatus, assignedUserId, startTime, endTime, dateAdded, dateUpdated, ...`. `startTime`/`endTime` are typed `object` in the spec (string or number in practice) → normalize to ISO-8601.

Implication: "upcoming appointments across all calendars" (the Loom prompt) needs one call **per calendar**. The proxy offers `calendars.events({ from, to })` without `calendarId` and fans out server-side (≤ 10 calendars, concurrency 3), merging and sorting by `startTime`. This keeps generated code simple and correct.

**Free slots — `GET /calendars/{calendarId}/free-slots`** (scope `calendars.readonly`; **not a Genesis runtime method** — platform fact).

- Query: `startDate`, `endDate` (**epoch ms; range ≤ 31 days**), optional `timezone`, `userId`, `userIds`.
- Response is keyed by date: `{ "2024-10-28": { "slots": ["2024-10-28T10:00:00-05:00", ...] }, ..., "traceId": "..." }` → normalize to `{ days: [{ date, slots }] }` by selecting keys that match `YYYY-MM-DD`.

### 5.4 Locations (`Version: 2021-07-28`)

**Get — `GET /locations/{locationId}`** (scope `locations.readonly`) → `{ location: { id, name, timezone, address, ... } }`. Called once at OAuth callback and refreshed at most daily for the prompt context.

---

## 6. Pagination shapes (why we normalize)

| API                   | Native cursor                                | Genesis cursor payload (opaque, base64url JSON)  |
| --------------------- | -------------------------------------------- | ------------------------------------------------ |
| Contacts search       | `searchAfter: [sortValue, id]` from last row | `{ "k": "contacts", "sa": [...] }`               |
| Conversations search  | `startAfterDate` = sort value of last row    | `{ "k": "conversations", "sad": 1712345678901 }` |
| Conversation messages | `lastMessageId` + `nextPage`                 | `{ "k": "messages", "lmi": "..." }`              |
| Calendar events       | Time window only (no cursor)                 | Caller moves the `from/to` window (≤ 31 days)    |

Generated code only ever sees `{ items, nextCursor, hasMore }`. Cursors carry a `k` (kind) so a contacts cursor cannot be replayed against messages.

---

## 7. Rate limits

- **Burst:** 100 requests per 10 seconds **per marketplace app per resource** (location or company).
- **Daily:** 200,000 requests per day per app per resource.
- Response headers: `X-RateLimit-Limit-Daily`, `X-RateLimit-Daily-Remaining`, `X-RateLimit-Interval-Milliseconds`, `X-RateLimit-Max`, `X-RateLimit-Remaining`.
- 429 responses may include `Retry-After`.

Design consequences: bounded retries with backoff on 429/5xx honoring `Retry-After`, logging of the remaining-burst header, and a per-preview call budget in the browser so a buggy generated loop cannot burn the location's quota. Assignment bonus R-B4 is implemented (per-user windows, daily caps, kill switch). There is no shared per-location proxy token bucket; `hlProxy` is 240/min in memory per `api` instance.

---

## 8. Webhooks (HighLevel platform)

HighLevel POSTs events to `hlWebhook` (R-B6). Facts below are the platform contract the function implements.

| Fact              | Detail                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subscription      | Set the webhook URL in the app settings and enable events; events are delivered for locations where the app is installed and the matching scope is granted                                                                                                                                                                                                        |
| Signature         | Header **`X-GHL-Signature`** — Ed25519 over the raw body, verified with HighLevel's published public key. The legacy RSA `x-wh-signature` header stopped on 2026-09-01 and is rejected.                                                                                                                                                                           |
| Replay protection | When `timestamp` is present, drop the event if it is older than 5 minutes (a late retry is useless in a live preview). Dedupe data events on `webhookId`, or on a hash of the signed body when `webhookId` is absent. Real Contact/Appointment/Message payloads often omit both fields. Appointment ids are nested under `appointment`. UNINSTALL is not deduped. |
| Key rotation      | Announced by email/Slack; key is a constant in our code, documented as such                                                                                                                                                                                                                                                                                       |
| Relevant events   | `ContactCreate`, `ContactUpdate`, `ContactDelete` (scope `contacts.readonly`), `AppointmentCreate/Update/Delete` (`calendars/events.readonly`), `InboundMessage`/`OutboundMessage` (`conversations/message.readonly`), `UNINSTALL` (app lifecycle)                                                                                                                |
| Raw body          | Cloud Functions expose `req.rawBody` (Buffer) — verify against it, never against a re-serialized `req.body`                                                                                                                                                                                                                                                       |

---

## 9. Marketplace alignment (why our preview design is "HighLevel-shaped")

HighLevel marketplace apps commonly surface as **Custom Pages** — iframes embedded in the HighLevel UI. Inside a Custom Page, the app asks its **parent window** for user context via `postMessage({ message: 'REQUEST_USER_DATA' })` and receives an encrypted payload that its backend decrypts with the app's Shared Secret.

Genesis' preview uses the same shape: the generated app runs in an iframe and talks **only to its parent** over a message channel, and the parent (plus our backend) holds every credential. A generated app is therefore one step away from being a real Custom Page: in production, the same `window.genesis.highlevel.*` contract would be served by a thin hosted runtime that resolves the location via the Shared-Secret SSO payload. This is our answer to "HighLevel marketplace-compatible".

---

## 10. Data we seed in the sandbox (for pagination and a convincing Loom)

| Data          | Amount                                               | Why                                                                                                                           |
| ------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Contacts      | ≥ 30 (names, emails, phones, a few tags)             | Page 2 of `contacts.list` exists at `limit=20` (adapters return cursors; generated apps are not required to render Load more) |
| Calendars     | 2 (e.g. "Consultations", "Follow-ups")               | Exercises the server-side events fan-out                                                                                      |
| Appointments  | 6–10 across the **next 14 days**, linked to contacts | "Upcoming appointments" has content                                                                                           |
| Conversations | 5+ with a few messages each (inbound + outbound)     | Messages view has content                                                                                                     |

Seeding options: CSV import in the sub-account (contacts), booking through the calendar widget or UI (appointments), adding inbound messages through the UI or `POST /conversations/messages/inbound` with a PIT (conversations).

---

## 11. Gotchas checklist

1. `/oauth/token` is **form-urlencoded**.
2. **Version header differs per API family** (2021-07-28 vs 2021-04-15).
3. Contacts cursor field is **`searchAfter`**, not `startAfter`.
4. Messages list may be **nested** under `messages.messages`.
5. Calendar events need **one of calendarId/userId/groupId** and **epoch-ms** times.
6. Free-slots and events ranges are **≤ 31 days**.
7. Refresh tokens **rotate** — single-flight refresh, persist both tokens.
8. Redirect URI and project ID must not contain **"highlevel"**.
9. No location name in the token response — needs **`locations.readonly`**.
10. 100 requests / 10 s per location — fan-out and loops must be bounded.
11. Sandbox sends may fail (no phone number) — errors must be surfaced, not swallowed.
12. Log `traceId` from error responses for support.

---

## 12. Day-1 spike checklist (VERIFY items)

Run these with the sandbox before building adapters; save scrubbed responses as fixtures in `functions/test/fixtures/hl/`.

| #   | Spike                                                                   | Pass condition                                     | Fallback                               |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------- |
| S1  | Authorize URL with `state` round-trip                                   | Callback receives the same `state`                 | Cookie-bound state (§2.6)              |
| S2  | Code exchange with form encoding, `user_type=Location`                  | 200 with `locationId`, `refresh_token`             | Try without `user_type`                |
| S3  | Refresh twice sequentially                                              | Second refresh uses the rotated token and succeeds | —                                      |
| S4  | Reuse an old refresh token                                              | Error body recorded (to map to `reauth_required`)  | —                                      |
| S5  | `POST /contacts/search` with `pageLimit` + `searchAfter`                | Page 2 differs from page 1                         | Page-number fallback                   |
| S6  | Messages response shape                                                 | Record nested vs flat                              | Adapter handles both                   |
| S7  | Conversations cursor field (`sort` vs `lastMessageDate`)                | Page 2 differs                                     | —                                      |
| S8  | `GET /calendars/events` with epoch-ms strings                           | Events returned                                    | Try numbers                            |
| S9  | `GET /locations/{id}`                                                   | Name + timezone                                    | Show location ID only                  |
| S10 | Localhost redirect URI accepted by the app settings                     | Save succeeds                                      | Cloudflare tunnel URL, or seed via PIT |
| S11 | (optional) `POST /conversations/messages` in sandbox — familiarize only | Success or a clear error body                      | Seed conversations from the UI instead |
