# Research 04 — LLM generation: provider, protocol, parsing, validation, cost

**Date:** 2026-09-26
**Sources:** Anthropic Claude API reference bundled with Claude Code (models, streaming, thinking/effort, prompt caching, error codes, refusal fallbacks — cached 2026-06-24), `@anthropic-ai/sdk@0.128.0` type definitions (inspected locally: `MessageStream.abort()`, `RequestOptions.signal`, `BetaFallbacksParam = Array<...> | 'default'`, `thinking.display`, `output_config.effort`, `StopReason` union), a scratchpad prototype of the streaming parser (property-tested, §6).
**Purpose:** Decide how Genesis talks to the model and turns a token stream into safe file operations.

---

## 1. Provider decision

**Claude via `@anthropic-ai/sdk`** (allowed by R-C1). Reasons: first-class streaming helpers (`messages.stream()`, `finalMessage()`, `abort()`), typed error classes, adaptive thinking with streamed summaries (fills the "dead air" before code starts), server-side refusal fallbacks, prompt caching with a 512-token minimum on the default model. A thin `ModelProvider` interface keeps a second provider possible; only `AnthropicProvider` and a deterministic `FakeProvider` (tests, local demo without a key) are built.

## 2. Model options

| Model            | ID                 | Context | Input / Output per MTok | Fit                                                                                            |
| ---------------- | ------------------ | ------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| Claude Opus 5    | `claude-opus-5`    | 1M      | $5 / $25                | **Default.** Anthropic's recommended general model; strong code generation                     |
| Claude Sonnet 5  | `claude-sonnet-5`  | 1M      | $2 / $10                | Faster/cheaper alternative — **your call** if Loom latency is a problem                        |
| Claude Opus 5.5  | `claude-opus-5-5`  | 1M      | $4 / $20                | Launching; thinking cannot be disabled, effort default `medium`. Use only if explicitly chosen |
| Claude Fable 5.1 | `claude-fable-5-1` | 1M      | $10 / $50               | Overkill for small apps                                                                        |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K    | $1 / $5                 | Too weak for multi-file apps with a strict protocol                                            |

The model is **configuration** (`ANTHROPIC_MODEL`), persisted on every generation document with the prompt version so results are attributable. Model IDs are used exactly as listed — no date suffixes.

## 3. Request shape (verified against SDK 0.128 typings)

```ts
const stream = client.beta.messages.stream(
  {
    model: config.anthropicModel, // 'claude-opus-5'
    max_tokens: 32_000, // bounded cost and time; see §7
    system: [
      {
        type: "text",
        text: STATIC_SYSTEM_PROMPT_V1,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages, // history + final user turn with project context
    thinking: { type: "adaptive", display: "summarized" }, // stream a readable plan while it thinks
    output_config: { effort: config.anthropicEffort }, // 'medium' default for this workload
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // server re-runs a policy-declined request on a fallback model
  },
  { signal: abortController.signal }, // cancel / disconnect / deadline
);

for await (const event of stream) {
  if (event.type === "content_block_delta") {
    if (event.delta.type === "text_delta") onText(event.delta.text);
    else if (event.delta.type === "thinking_delta")
      onThinking(event.delta.thinking);
  }
}
const final = await stream.finalMessage(); // stop_reason, usage, model
```

Notes:

- `client` is constructed with `maxRetries: 2` (the SDK retries 408/409/429/5xx and connection errors before the stream starts) and `timeout: 600_000` ms.
- Do **not** pass `stream: true` to `.stream()` (it is implied).
- No assistant prefill (rejected on current models).
- No `temperature`/`top_p` (rejected on Opus 5).

## 4. Stream semantics we rely on

| Item          | Detail                                                                                                                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Events        | `message_start` → per block `content_block_start` / `content_block_delta` / `content_block_stop` → `message_delta` (stop reason, usage) → `message_stop`                                                                                                   |
| Deltas        | `text_delta` (our protocol text), `thinking_delta` (summarized plan, `display: 'summarized'`)                                                                                                                                                              |
| Final message | `await stream.finalMessage()` after iteration → `stop_reason`, `usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`), `model`                                                                                |
| Abort         | `stream.abort()` or the request `signal`; iteration throws `Anthropic.APIUserAbortError` — map using `signal.reason` (cancel vs disconnect vs deadline)                                                                                                    |
| Stop reasons  | `end_turn`, `max_tokens`, `stop_sequence`, `tool_use`, `pause_turn`, `refusal`, `model_context_window_exceeded` — we handle `end_turn`, `max_tokens` (truncation), `refusal`, `model_context_window_exceeded`; anything else → `GENERATION_INVALID_OUTPUT` |
| Refusal       | With `fallbacks: 'default'` a decline is re-run server-side on the recommended fallback model; a final `stop_reason: 'refusal'` means the whole chain declined → `GENERATION_REFUSED`, nothing applied                                                     |

Error classes (check most specific first; `APIConnectionError` before `APIError` because it is a subclass in TypeScript):

| SDK class / status                                                                 | Genesis code                                         | Retryable |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------- | --------- |
| `RateLimitError` (429)                                                             | `LLM_RATE_LIMITED`                                   | yes       |
| `InternalServerError` (500), status 529 `overloaded_error`                         | `LLM_UNAVAILABLE`                                    | yes       |
| `APIConnectionError` / `APIConnectionTimeoutError`                                 | `LLM_UNAVAILABLE`                                    | yes       |
| `APIUserAbortError`                                                                | interrupted / timeout (from `signal.reason`)         | —         |
| `AuthenticationError`, `PermissionDeniedError`, `NotFoundError`, `BadRequestError` | `INTERNAL` (configuration fault, logged server-side) | no        |

Mid-stream errors (for example an `overloaded_error` event after some text) throw during iteration; already-validated files stay staged (partial results preserved).

## 5. Thinking, effort, latency

- On Opus 5 thinking is **adaptive and on by default**; the default display is **omitted** (empty thinking text), which looks like a pause. We set `display: 'summarized'` and forward thinking deltas as `assistant.thinking` events — the chat shows a collapsible "Planning…" block instead of silence.
- **Do not disable thinking.** With thinking disabled, current models can leak internal tags into visible text — that text is our file protocol.
- Effort: `low | medium | high | xhigh | max` (default `high`). Small, fully specified apps with a latency-sensitive streaming UX → **default `medium`**, overridable with `ANTHROPIC_EFFORT`.
- **Fast mode** exists as an Anthropic research preview (`betas: ['fast-mode-2026-02-01']`, `speed: 'fast'`). Genesis v1 does not enable it.

## 6. Output protocol — options and decision

| Option                                                                  | Live streaming into editor                                                                                                  | Robustness                                           | Complexity  | Verdict                                 |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------- | --------------------------------------- |
| **A. Line markers** `⟦FILE path="…"⟧ … ⟦/FILE⟧`, `⟦DELETE path="…"⟧`    | Excellent — raw text deltas are file text                                                                                   | Good with a tolerant incremental parser + validation | Low         | **Chosen**                              |
| B. Client tool `write_file({path, content})` with eager input streaming | Content arrives as partial JSON; needs incremental JSON-string unescaping for live display; truncated input can still parse | High schema guarantees                               | Medium–high | Upgrade path if evals show marker drift |
| C. Structured output (JSON schema)                                      | Final JSON only unless partial-JSON parsing                                                                                 | High                                                 | Medium      | Worse UX                                |
| D. Markdown fences with filenames                                       | Fences collide with content; ambiguous                                                                                      | Low                                                  | Low         | Rejected                                |

Protocol rules (normative in the system prompt):

- Markers sit at line starts. Opening marker alone on its line; content begins on the next line; `⟦/FILE⟧` alone on its own line.
- `⟦FILE⟧` = create or **fully replace**; `⟦DELETE⟧` = delete. No patches/diffs in v1 (future improvement for large files).
- Language is **derived from the extension** — no `lang` attribute (the parser tolerates and ignores extra attributes, so the earlier draft's `lang="…"` still parses).
- Brief prose (1–3 sentences) first; nothing but whitespace after the last marker (tolerated if present).
- `⟦` (U+27E6) and `⟧` (U+27E7) are single UTF-16 code units — safe for `indexOf` on JS strings.

### 6.1 Parser invariants (proven on the prototype)

A state machine with a small carry buffer (`05-backend-system-design.md` §8.7). The scratchpad prototype passed **9 tests including a 3,000-document property test** with random chunk splits of 1–12 characters and adversarial content containing lone `⟦`, `⟧`, `\r\n`, quotes and angle brackets:

1. **Chunking invariance** — the event sequence (after merging adjacent text events) is identical no matter how the stream is split.
2. **Content integrity** — for every completed file, the concatenation of `file_chunk` texts equals the final content, so the live editor always shows exactly what will be saved.
3. **No marker leakage** — prose and file chunks never contain a marker or a partial marker.
4. **Recovery** — a new `⟦FILE` at a line start before `⟦/FILE⟧` closes the previous file as _aborted_ (not saved) and continues; an unterminated file at stream end is aborted; a malformed marker becomes prose plus a warning.
5. **Newline semantics** — the newline after an opening marker and the one before `⟦/FILE⟧` belong to the markers; CRLF split across chunks is handled.

These defects exist in the earlier draft's scanner (dropped prose, leaked partial markers into chat and editor, unbounded buffer, strict attribute order) — see `02-architecture-review.md`.

## 7. Validation layers

| Layer   | When                         | Checks                                                                                                                                                                                                                                                                                                                                                                                                                            | Failure effect                                            |
| ------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------- |
| Path    | `file_start` / `file_delete` | Regex `^(?:[a-z0-9_-]+/){0,2}[a-z0-9_-]+(?:\.[a-z0-9_-]+)\*\.(html                                                                                                                                                                                                                                                                                                                                                                | css                                                       | js)$`; only `index.html`may be HTML; depth ≤ 3; cannot delete`index.html` | File rejected (stream continues) |
| File    | `file_end`                   | UTF-8 size 1 byte–100 KB; no NUL; no marker sequences; JS parses with `acorn` (`ecmaVersion: 'latest'`, `sourceType: 'script'`); no remote `<script src>`/`<link href>`; **policy errors**: HighLevel API hostnames, credential-shaped strings (`sk-ant-…`, JWT triplets, long bearer literals); **policy warnings**: `fetch`, `XMLHttpRequest`, `WebSocket`, storage APIs, `alert/confirm/prompt`, `innerHTML` with dynamic data | Rejected with issues, or accepted with warnings           |
| Project | After stream end             | `index.html` exists; all local `<script src>`/`<link rel=stylesheet href>` references exist; ≤ 25 files; ≤ 300 KB total; unreferenced JS/CSS → warning                                                                                                                                                                                                                                                                            | Generation fails with issues if errors; nothing committed |

Matching the marker format is never sufficient on its own — every file is validated regardless.

## 8. Context bounding

| Part                 | Content                                                                                                                   | Bound                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Static system prompt | Role, protocol, runtime constraints, SDK reference, quality bar                                                           | ~1.5k tokens, **cached**                                                                                             |
| Project              | Name, description, **all current files** in `<project_files>`                                                             | ≤ 300 KB by construction (project cap); budget function drops oldest non-entry files first if the cap is ever raised |
| Session              | Last 12 chat messages (assistant turns include "files changed" notes), each ≤ 4,000 chars                                 | ~12k tokens worst case                                                                                               |
| External (HighLevel) | Location name + timezone, up to 20 calendar names, approximate contact count, available SDK methods (from granted scopes) | ≤ 2 KB; cached 5 min per location; omitted with a note on failure — **no PII**                                       |
| Request              | The user prompt                                                                                                           | ≤ 4,000 chars                                                                                                        |

Worst case ≈ 100k input tokens; typical 6–15k. Everything inside `<project_files>`, `<highlevel_context>` and `<conversation_notes>` is declared **data, not instructions** (prompt-injection hygiene).

## 9. Prompt caching

- Minimum cacheable prefix on Opus 5: **512 tokens** (our static prompt is ~3× that).
- Put `cache_control` on the static system block only; keep timestamps, IDs and per-request data out of the system prompt.
- Verify with `usage.cache_read_input_tokens > 0` on the second generation within 5 minutes; persist the usage numbers on the generation document.

## 10. Cost model (Opus 5, $5 in / $25 out per MTok)

| Scenario                           | Input tokens     | Output tokens (incl. thinking) | Cost        |
| ---------------------------------- | ---------------- | ------------------------------ | ----------- |
| First generation of a 3–5 file app | ~6k (2k cached)  | ~7–10k                         | ~$0.20–0.30 |
| Refinement on a 20 KB project      | ~12k (2k cached) | ~3–6k                          | ~$0.13–0.21 |
| Worst case (`max_tokens` 32k)      | ~100k            | 32k                            | ~$1.30      |

Controls: `max_tokens` 32k, 300 s generation deadline, provider-side monthly spend limit. Per-route Cloud Function rate limits, a global generation cap, and a `GENERATION_ENABLED` kill switch are out of v1 (assignment bonus R-B4).

## 11. Quality checks considered (out of v1)

An eval harness against golden prompts is out of this submission. If added later, deterministic checks would cover the Loom prompt (contacts list + calendar events, no `fetch(`, JS parses) and follow-up edits that emit only changed files. Create-contact and free-slots prompts are not product cases.
