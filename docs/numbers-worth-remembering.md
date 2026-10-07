# Numbers worth remembering

Figures come from the code (`functions/src/index.ts`, `contracts/limits.ts`, `rate-limiter.ts`) unless marked as an estimate.

## If you remember only five

- 100 streams ≈ 67 generations per minute
- ≈ $0.08 per generation
- 200 generations per day cap
- HighLevel: 100 requests per 10 s per location
- Heartbeat 15 s, lease stale after 60 s

## Scale and cost (estimates)

| What | Number |
|---|---|
| Generation streams at once | 100 (5 instances × 20) |
| Generation throughput ceiling | ≈ 1.1 per second, ≈ 67 per minute (100 ÷ ~90 s) |
| api requests in flight | 800 (10 instances × 80) |
| Cost per generation | ≈ $0.08 (≈10k input, 5–8k output tokens) |
| Claude Sonnet 5 price | $2 per million input tokens, $10 per million output tokens |
| Firestore writes per generation | ≈ 40–50 (see breakdown below) |
| At 100,000 generations a day | ≈ 1.2/s average, ≈ 3.5/s peak, ≈ 315 streams, ≈ $8,000/day |

## The three functions

| Function | Memory | Timeout | Concurrency | Max instances | Secrets |
|---|---|---|---|---|---|
| `api` | 512 MiB | 60 s | 80 | 10 | 3 (HighLevel client id, client secret, encryption key) |
| `generate` | 1 GiB | 540 s | 20 | 5 | all 4 |
| `hlWebhook` | 256 MiB | 30 s | 40 | 5 | none |

Region: us-central1. Firestore: nam5. Minimum instances default to 0.

## Product limits

| Limit | Value |
|---|---|
| Prompt | 4,000 characters |
| History sent to the model | 12 turns |
| Files per project | 25 |
| Size per file | 100 KB |
| Size per project | 300 KB |
| Model output | 32,000 tokens |
| Generation deadline | 300 s |
| SDK | 7 read methods, 6 read-only scopes |
| Raw model output stored | up to 900 KB per generation |

## Timings

| What | Value |
|---|---|
| Heartbeat | 15 s |
| Lease considered dead | 60 s |
| Browser stream watchdog | 45 s |
| Silent run marked interrupted by the client | 90 s |
| OAuth state lifetime | 10 min |
| HighLevel token refreshed when less than | 5 min left |
| Refresh lease | 30 s |
| HighLevel call timeout | 15 s |
| HighLevel read retries | 2 |
| `Retry-After` honoured up to | 10 s |
| Token endpoint timeout | 10 s |
| Metadata fetch gives up after | 2.5 s |
| Location metadata cached | 5 min |
| Webhook events kept | 24 h |
| Webhook timestamp window | 5 min |
| CORS preflight cached | 10 min |

## Rate limits

| Rule | Limit | Counted in |
|---|---|---|
| Generations per user | 10 per 10 min | Firestore |
| Generations per user per day | 40 | Firestore |
| Generations for everyone per day | 200 | Firestore (one document) |
| File saves | 60 per min | Firestore |
| Snapshot restores | 10 per 10 min | Firestore |
| OAuth starts | 5 per min | Firestore |
| HighLevel proxy calls | 240 per min per user | Instance memory |
| Preview bridge | 6 in flight, 120 per min, ≤ 64 KB, 20 s timeout | Browser |

## Tokens and security

| What | Value |
|---|---|
| Firebase ID token | 1 hour, renewed by the SDK |
| HighLevel access token | ≈ 1 day |
| HighLevel refresh token | single use (rotates on every refresh) |
| OAuth state | 32 random bytes, stored as a SHA-256 hash, 10 min, single use |
| AES-256-GCM | 32-byte key, 12-byte IV, 16-byte tag, AAD `hl:{uid}:{field}` |
| Secret Manager secrets | 4 |

## HighLevel and Firestore

| What | Value |
|---|---|
| HighLevel rate limit | 100 per 10 s and 200,000 per day, per app per location |
| HighLevel Version headers | 2021-07-28 (contacts, locations) · 2021-04-15 (calendars, conversations) |
| One Firestore document | ≈ 1 sustained write per second |
| Firestore document size limit | 1 MiB |
| Prompt cache | reads 0.1×, writes 1.25×, 5 min lifetime, at least 1,024 tokens |

## Firestore writes per generation (estimate: 5 files, ~90 s)

| Step | Writes |
|---|---|
| Rate-limit counters | 3 |
| Start transaction (generation, user message, project lease) | 3 |
| Heartbeats (≈6, two docs each) | ≈ 12 |
| Staged files | 5 |
| Raw model output | 1 |
| Commit (5 files, 5 new blobs, snapshot, message, generation, project) | ≈ 14 |
| **Total** | **≈ 38**, toward 50 with more files or longer runs |

## The codebase

| What | Value |
|---|---|
| Tests | ≈ 300 (unit, property, integration, security rules, contract) |
| Functions / trust zones | 3 / 4 |
| Design review | 54 findings fixed, 4 critical |
