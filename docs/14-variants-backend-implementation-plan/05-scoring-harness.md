# BV-5 — Scoring harness (gates, scenarios, probes, static checks, objective score)

> **As built.** The harness is in `variants/harness/`: `inline-project.ts`, `mock-genesis.ts`, `fixtures.ts`, `probes.ts`, `static-checks.ts`, `gates.ts`, `score.ts` and `sandbox/{run-in-sandbox,sandbox-entry}.ts`. The file split in this plan (`scoring/`, `gates/`, `probes/`, `static/`, `fixtures/`) was not used. The public function is `scoreCandidate(files, checklist)` and the gates function is `evaluateGates`. Differences from the steps below: one fixture file with two sets of two contacts and two events; no `fixturesFor`; the mock's `calendars.events` returns every event regardless of range; the loading scenario is a promise that never resolves, read after 40 ms; observations carry text, buttons, inputs and calls; `validOutput` checks only that `index.html` exists; `usesRealData` accepts one distinguishing name per run; `safe` checks the adversarial scenario only; the sandbox has no second-message kill and no output cap; scenarios run three at a time; the baseline load-more and date-range items earn no state-handling points; `scoringTimeoutMs` is not enforced. The inliner fix: elements built by hand carry `tagName` and `namespaceURI`, because the parse5 serializer drops nodes without them. §13.1 of the feature document is the current behaviour.

> Read [`00-overview.md`](00-overview.md) first. Design: [`../13-variants-feature.md`](../13-variants-feature.md) D10–D13, D26, §7. Existing code reused: `validation/validate-project.ts` (project validation, policy rules, `html-refs.ts`, `js-syntax.ts`), `parse5` and `acorn` (already dependencies), `contracts/hl-runtime.ts` (record shapes), `shared/async.ts`.

**Outcome:** given a candidate's files and the run's checklist, the backend returns an **objective score**: gate results, per-part points (deterministic share), per-checklist-item evidence and a bundle of observations for the judge. The generated code runs only inside an isolated child process against fixtures. Nothing here calls an LLM.

**Scoring is of behaviour.** The harness is a model of a browser (jsdom), not a real one (risk R2). It observes DOM text, structure, SDK calls, errors and timing. It does not compute layout.

---

### Task BV-5.1: Sandbox process (isolation for LLM-written code)

**Files:**

- Modify: `functions/package.json` (add `jsdom`, `@types/jsdom`, `css-tree`, `@types/css-tree`)
- Create: `functions/src/modules/generation/variants/harness/sandbox/run-in-sandbox.ts` (parent side)
- Create: `functions/src/modules/generation/variants/harness/sandbox/sandbox-entry.ts` (child side)

**Interfaces:**

- Consumes: `node:child_process`, `LIMITS.variants`, `withTimeout`.
- Produces:
  - `interface SandboxJob { html: string; scenario: ScenarioSpec; mockScript: string }`
  - `interface SandboxOutput { ok: true; observation: ScenarioObservation } | { ok: false; reason: 'timeout' | 'crash' | 'oom' | 'protocol'; detail: string }`
  - `runInSandbox(job: SandboxJob, opts: { timeoutMs: number }): Promise<SandboxOutput>`

- [ ] **Step 1: Parent.** Fork the compiled `sandbox-entry.js` (`lib/…` path resolved from `import.meta.url`) with:

```ts
const child = fork(entryPath, [], {
  env: {}, // no secrets, no ADC variables, no proxy settings
  execArgv: [
    `--max-old-space-size=${LIMITS.variants.sandboxMemoryMb}`,
    '--permission', // deny fs write, child_process, worker, addons (Node 24 permission model)
    `--allow-fs-read=${entryDir}`, // plus the node_modules paths jsdom needs (resolved at startup)
  ],
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  serialization: 'json',
});
```

Send `SandboxJob` over IPC, resolve on the single `result` message, and **kill the child** on `timeoutMs`, on `exit` before a result, or on any second message. Never reuse a child. Output size is capped (1 MB) before parsing. One child per scenario run; a candidate's scenarios run sequentially in separate children so one hang cannot affect the others.

- [ ] **Step 2: Child.** Receives the job, builds `new JSDOM(job.html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://preview.invalid/' })` after injecting `job.mockScript` as the first script, applies the scenario driver (BV-5.5) and posts back the `ScenarioObservation`. jsdom's default resource loader is left disabled (no external fetches). The child holds no credentials because it has none in its environment; it also never receives file contents other than the candidate's own files.

- [ ] **Step 3: Verification of the assumptions in this design** (do this once, record the outcome in `13` §12): (a) the `--permission` flags above are valid on the deployed Node 24 runtime and the child can still load jsdom; (b) the child cannot read `/proc/self/environ` of the parent or files outside the allowed read path; (c) the child's outbound network behaviour: **Node's permission model does not restrict network access**, so a code escape could reach the metadata server. If isolation cannot be shown, the fallback is to run the harness in a **separate Cloud Run service** with no service-account permissions and no network egress (VPC egress denied), called over authenticated HTTP. The `runInSandbox` signature is the seam; only its implementation changes.

**Done when:** a job whose script loops forever or allocates without limit ends with `timeout` or `oom` within the limit; the child's `process.env` is empty; the parent process is unaffected.

---

### Task BV-5.2: Project inliner

**Files:**

- Create: `functions/src/modules/generation/variants/harness/inline-project.ts`

**Interfaces:**

- Consumes: `parse5`, the candidate's `FileOp[]` (writes only), `html-refs.ts` rules.
- Produces: `inlineProject(files: ReadonlyMap<string, string>): { html: string } | { error: string }`.

- [ ] **Step 1:** Mirror what the preview host does (the system prompt says "the host inlines these files"): parse `index.html`, replace each `<link rel="stylesheet" href="X">` with `<style>` containing file `X`, replace each `<script src="X"></script>` with an inline `<script>` in document order, fail if a referenced file is missing or a reference is external. Keep the source of truth in mind: **read the frontend preview compiler first** (`frontend/src/…/preview`) and match its behaviour exactly (order, handling of `type`, `defer`, base paths). Record the frontend file and commit it mirrors in a header comment (risk R5).

- [ ] **Step 2:** Return the final HTML as a string. Inline `</script>` sequences inside file contents are escaped the same way the host does.

**Done when:** for a valid project, `inlineProject` produces the same executable document structure the preview would run, and a project with a missing reference returns an `error` (which fails the `validOutput` gate with a clear detail).

---

### Task BV-5.3: Mock `window.genesis` and fixtures

**Files:**

- Create: `functions/src/modules/generation/variants/harness/mock-genesis.ts`
- Create: `functions/src/modules/generation/variants/harness/fixtures/{set-a,set-b,adversarial}.ts`
- Create: `functions/src/modules/generation/variants/harness/fixtures/index.ts`

**Interfaces:**

- Consumes: `Contact`, `Conversation`, `Message`, `Calendar`, `CalendarEvent`, `Location` types.
- Produces:
  - `interface FixtureSet { id: 'A' | 'B'; location: Location; contacts: Contact[]; conversations: Conversation[]; messages: Record<string, Message[]>; calendars: Calendar[]; events: CalendarEvent[]; pageSize: number }`
  - `fixturesFor(i: { calendarCount: number }): { a: FixtureSet; b: FixtureSet; adversarial: FixtureSet }`
  - `interface ScenarioSpec { name: 'data' | 'dataB' | 'empty' | 'error' | 'twoPages' | 'adversarial' | 'loading' | 'rows100'; fixture: FixtureSet; interactions: Interaction[] }`
  - `renderMockScript(spec: ScenarioSpec): string` (a self-contained script string, no imports)

- [ ] **Step 1: The mock.** A script string run before the app's scripts. It defines a frozen `window.genesis` equal in shape to the real runtime (`ready` promise, `context`, `highlevel` with the seven methods, `on()` returning an unsubscribe), plus a **non-enumerable** `window.__genesisCalls` array logging `{ method, params, at }` for every call. Behaviour by scenario:

| Scenario      | Behaviour                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data`        | Returns fixture A. Paged methods return `pageSize` items with `hasMore: false` and `nextCursor: null`.                                                                                                              |
| `dataB`       | Same as `data` with fixture B (different people, titles, ids, timezone, location).                                                                                                                                  |
| `twoPages`    | First page `hasMore: true`, `nextCursor: 'p2'`; a call with `cursor: 'p2'` returns the remainder. `calendars.events` has no cursor.                                                                                 |
| `empty`       | Every list returns `{ items: [] , nextCursor: null, hasMore: false }`; `location.get` still returns the location.                                                                                                   |
| `error`       | Every data method rejects with `Object.assign(new Error('Could not reach your calendar. Try again in a moment.'), { code: 'HL_UNAVAILABLE', retryable: true })`. The message is fixed so the probe can look for it. |
| `loading`     | Methods return a promise that resolves only when the driver calls `window.__release()` after taking the "during load" snapshot.                                                                                     |
| `adversarial` | Fixture whose names and titles include `<img src=x onerror="window.__xss=1">`, `<script>window.__xss=1</script>`, very long names, emoji, RTL text, and null in every nullable field.                               |

`calendars.events({ from, to })` returns only events within `[from, to]` (so a candidate that requests a bad range sees fewer records) and rejects with `VALIDATION_FAILED` when `to - from` exceeds 31 days, mirroring the real contract. `window.genesis.context` carries `location.id/name/timezone` from the fixture set and `project`.

- [ ] **Step 2: Fixtures.** Typed data, no network or random values (fully deterministic).
  - **Set A** (about 12 contacts, 14 events, 6 conversations): distinct, recognisable names (for example "Priya Sharma", "Marcus O'Neil"), event titles and statuses (`confirmed`, `cancelled`, `showed`, `noshow`), events spread across the next 21 days in the location's timezone (`Asia/Kolkata`), one calendar when `calendarCount === 1`, otherwise three.
  - **Set B**: disjoint names, titles, ids and timezone (`America/Chicago`), same sizes. No token appears in both sets.
  - **Adversarial**: as above.
  - Dates are generated **relative to a fixed anchor** (`2026-01-05T09:00:00Z`) and the mock reports that anchor as "now" (`Date` is patched in the mock so "upcoming" is stable). The patched `Date` and `Intl.DateTimeFormat` default to the anchor; the app's own timezone formatting still uses the fixture's `timezone`.
  - A fraction of records has null optional fields (phone, email, status), chosen deterministically (every 4th record).

- [ ] **Step 3:** `fixturesFor({ calendarCount })` uses 1 calendar when the account has 1 (or when unknown), and 3 otherwise, so the multi-calendar checklist items are exercised only when the owner's account has several calendars.

**Done when:** the mock script contains no dependency on the host, is deterministic, and every scenario's response shapes match `Page<T>` / `ItemsResult<T>`.

---

### Task BV-5.4: Gates

**Files:**

- Create: `functions/src/modules/generation/variants/gates/{valid-output,boots,uses-real-data,safe}.ts`
- Create: `functions/src/modules/generation/variants/gates/run-gates.ts`

**Interfaces:**

- Consumes: `FileOp[]`, `applyOps`/`validateProject` (existing), `ScenarioObservation`, fixtures.
- Produces: `interface GateResult { gate: GateName; passed: boolean; detail: string }`; `runGates(i): GateResult[]`; `gatesPassed(gs): boolean`.

- [ ] **Step 1: `validOutput`** — pass when `decideOutcome` for the candidate attempt returned `commit` (valid files, no project-level errors, not truncated) **and** `inlineProject` succeeded. `detail` is the first error code, not the full message.

- [ ] **Step 2: `boots`** — from the `data` scenario observation: pass when there was no uncaught exception, no unhandled rejection, no `window.onerror`, and the app produced visible text (more than the document title) within `scenarioTimeoutMs`.

- [ ] **Step 3: `usesRealData`** — compare the `data` (fixture A) and `dataB` (fixture B) observations:
  1. extract **distinguishing tokens** from each fixture (names or titles that appear in only that set);
  2. pass only if the A run's visible text contains at least `min(3, available)` A-tokens **and** none of the B tokens, and the B run the mirror image;
  3. fail with `detail: 'output did not change with the data'` when the visible text of A and B is identical, or contains tokens not in either fixture (invented records).

- [ ] **Step 4: `safe`** —
  1. no policy errors from `validateProject` (credential and HighLevel-host strings; existing rules);
  2. in the `adversarial` run, `window.__xss` is unset, `document.querySelector('img[onerror]')` is null, and the visible text contains the literal string `<img` (it was rendered as text);
  3. no use of `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `eval`, `new Function` (static scan, BV-5.7).

- [ ] **Step 5:** `runGates` returns all four results (never short-circuits, so the stored evidence is complete). `eligible = gatesPassed(gates)`.

**Done when:** each gate returns a stable `detail` string of at most 300 characters and no fixture content or generated code appears in it.

---

### Task BV-5.5: Scenario runner

**Files:**

- Create: `functions/src/modules/generation/variants/harness/run-scenarios.ts`
- Create: `functions/src/modules/generation/variants/harness/observation.ts`
- Create: `functions/src/modules/generation/variants/harness/dom-queries.ts` (child-side helpers, bundled into the sandbox entry)

**Interfaces:**

- Consumes: `runInSandbox`, `inlineProject`, `renderMockScript`, `fixturesFor`.
- Produces:
  - `interface ScenarioObservation { scenario: ScenarioSpec['name']; errors: string[]; unhandled: string[]; calls: { method: string; params: unknown }[]; text: string; textBefore: string | null; rows: RecordLocation[]; controls: ControlFlags; domNodeCount: number; consoleCount: number; renderMs: number; interaction: InteractionResult[]; timedOut: boolean; xss: boolean }`
  - `runScenarios(i: { files: ReadonlyMap<string, string>; calendarCount: number; wanted: ScenarioName[] }): Promise<Map<ScenarioName, ScenarioObservation | SandboxFailure>>`

- [ ] **Step 1: What a scenario run does (child side).** Load the document, wait for `ready` and a quiet period (no DOM mutations for 150 ms, capped at 3 s), then collect:
  - `text`: visible text of `document.body` (skip `script`, `style`, hidden elements by the `hidden` attribute, `display: none` inline style, and `aria-hidden`), whitespace-normalised;
  - `rows`: for each fixture record, the DOM element that represents it (see Step 2) and that element's text;
  - `controls`: presence flags for search (an `input` that is `type=search`, has `role=searchbox`, or whose label/placeholder/aria-label matches `/search|find|filter/i`), filter (a `select`, chips or buttons labelled `/filter|status|show/i`), refresh (`/refresh|reload/i`), dateRange (two date inputs, a `select` of `/week|month|day|range/i` options, or next/previous controls);
  - `calls`: the `__genesisCalls` log; `consoleCount`: calls to `console.*`; `domNodeCount`; `renderMs` (from navigation start to the quiet period);
  - `errors` and `unhandled`: `window.onerror` and `unhandledrejection` messages (truncated to 200 characters, deduped).

- [ ] **Step 2: Record location (row detection).** For a record with a unique token (name or title), find the text node containing it, then walk up to the **smallest ancestor** that also contains at least half of the record's other expected field tokens (or the 6th ancestor, whichever is first). That ancestor is the record's row. This tolerates tables, lists, cards and detail panels, and is deliberately heuristic (risk R3). Rows of different records must not be the same element; if they are (a single container holding everything), `rows` is empty for that run and field-level probes fall back to whole-page text matching with half credit.

- [ ] **Step 3: Interactions.** A scenario may carry interactions executed after the quiet period, each recorded in `interaction[]` with the SDK calls it caused:
  - `typeSearch(text)`: focus the search control, set `value`, dispatch `input` and `change` (and `keydown` Enter / `submit` on the form), wait for quiet (debounce allowance up to 900 ms real time);
  - `clickLoadMore`: click the first button or link whose accessible name matches `/load more|show more|more|next/i`, wait for quiet;
  - `release`: for `loading`, take `textBefore` first, then call `window.__release()`.

- [ ] **Step 4: Which scenarios run.** Always `data`, `dataB`, `empty`, `error`, `adversarial`, `loading`. Run `twoPages` only if the checklist has a `loadMoreAppends` probe, the search interaction only if the checklist has `searchCallsWith`, and `rows100` (fixture A repeated to 100 records, used only by the render-budget check) only when `appType` is `list`. Scenarios run **sequentially** per candidate, each in its own sandbox child, each limited to `scenarioTimeoutMs` (8 s). A failed scenario yields a `SandboxFailure` that probes treat as "not observed" (0 credit, evidence `scenario failed: timeout`).

**Done when:** each scenario returns an observation or a typed failure within its limit, observations are JSON-serialisable and under 1 MB, and no observation includes raw generated source.

---

### Task BV-5.6: Probes

**Files:**

- Create: `functions/src/modules/generation/variants/probes/{calls,renders-fields,sorted-by,search-calls-with,has-control,state-loading,state-empty,state-error,load-more-appends,date-range-call}.ts`
- Create: `functions/src/modules/generation/variants/probes/index.ts`

**Interfaces:**

- Consumes: `Probe` (contracts), `ScenarioObservation`, `FixtureSet`.
- Produces: `interface ProbeResult { passed: boolean; score: number; evidence: string }` where `score` is 0–1 (some probes give partial credit); `evaluateProbe(probe: Probe, ctx: ProbeContext): ProbeResult` with a single registry keyed by `probe.probe`.

- [ ] **Step 1: Context.**

```ts
interface ProbeContext {
  obs: ReadonlyMap<ScenarioName, ScenarioObservation | SandboxFailure>;
  fixtures: { a: FixtureSet; b: FixtureSet; adversarial: FixtureSet };
  files: ReadonlyMap<string, string>;
}
```

All probes are pure functions of this context. Each returns `evidence` as a short sentence with counts only, for example `"9 of 12 records showed title, start and status"`.

- [ ] **Step 2: Definitions.**

| Probe             | Scenario(s)           | Passes when / score                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------- | --------- | --- | ------------------------------------------------------------------- |
| `calls`           | `data`                | `calls` contains `method`. Score 1 or 0.                                                                                                                                                                                                                                                                                                                                                                                     |
| `rendersFields`   | `data`                | Per record × field, the field's value is in that record's row. Strings: exact normalised match. Dates: any rendering that contains the day number and either the month (name or number) or the time, computed for the fixture's timezone. Null values count as satisfied when the row shows `—`, `-`, or nothing, and **not** when it shows `null`, `undefined` or `NaN`. Score = matched / expected. Passes at score ≥ 0.8. |
| `sortedBy`        | `data`                | Records' first appearance order in the DOM matches the fixture sorted by `field` and `direction` (Kendall-tau over the visible records ≥ 0.9). Nulls last.                                                                                                                                                                                                                                                                   |
| `searchCallsWith` | `data` + `typeSearch` | After typing a known A-token, a later call to `method` carries `params.query` containing it. Score 1 or 0.                                                                                                                                                                                                                                                                                                                   |
| `hasControl`      | `data`                | The matching control flag in `controls` is true.                                                                                                                                                                                                                                                                                                                                                                             |
| `state.loading`   | `loading`             | `textBefore` is non-empty, contains no fixture tokens, and differs from the post-release text (some loading indicator or placeholder existed before data). Also passes if an element with `aria-busy="true"` or `role="status"` was present before release.                                                                                                                                                                  |
| `state.empty`     | `empty`               | No fixture tokens in `text`; visible text longer than 20 characters beyond static labels; contains a "nothing to show" phrase (`/no                                                                                                                                                                                                                                                                                          | nothing   | empty                                   | not found | yet | none/i`). Score 0.5 for no tokens + not blank, +0.5 for the phrase. |
| `state.error`     | `error`               | `text` contains the fixed error message (verbatim). If the mock's error was `retryable`, a button matching `/retry                                                                                                                                                                                                                                                                                                           | try again | reload/i` also exists: score 0.5 + 0.5. |
| `loadMoreAppends` | `twoPages` + click    | After the click there is a call with `cursor: 'p2'`; the number of rows increased; and no call fetched page two before the click (not auto-looping). Score 1/0.5/0 for all / click-works-but-auto-loaded / not working.                                                                                                                                                                                                      |
| `dateRangeCall`   | `data`                | Every `calendars.events` call has `from`/`to` valid ISO strings with `to - from ≤ 31 days` and `from < to`. Score 1/0.                                                                                                                                                                                                                                                                                                       |

- [ ] **Step 3: Checklist evaluation.** `evaluateChecklist(checklist, ctx): ChecklistResult[]` evaluates each item: `probe` items via the registry, `judge` items return `{ passed: null, points: 0 }` here and are filled in by the judge (BV-6). Item weights: `core` 2, `nice` 1, `baseline` 1.5.

**Done when:** every `Probe` member of the contract has an implementation; evidence strings contain no record values, only counts and generic labels.

---

### Task BV-5.7: Static analyzers

**Files:**

- Create: `functions/src/modules/generation/variants/static/{a11y,responsive,css-proxies,contrast,code-hygiene,language}.ts`
- Create: `functions/src/modules/generation/variants/static/index.ts`

**Interfaces:**

- Consumes: the candidate's files; `parse5` (HTML), `css-tree` (CSS), `acorn` (JS, already used by `js-syntax.ts`).
- Produces: `analyzeStatic(files): StaticReport` with the sub-scores below, each a number in 0–1 plus a short evidence string.

- [ ] **Step 1: `a11y`** (HTML): every `img` has `alt`; every `input`/`select`/`textarea` has a label (`<label for>`, wrapping label, `aria-label`, `aria-labelledby`); every button/link has text or `aria-label`; a single `h1` and no skipped heading levels; `<html lang>`; interactive elements are native or have a role and `tabindex`. Score = passed checks / applicable checks.

- [ ] **Step 2: `responsive`** (CSS + HTML): has `<meta name="viewport" content="width=device-width…">`; at least one `@media` rule or use of flex-wrap / grid with `auto-fit`/`minmax` / container-relative units; no fixed pixel `width` above 480 px on layout containers (`body`, `main`, top-level wrappers) without `max-width`; tables are in a scrollable wrapper or have a responsive pattern. Score = passed checks / applicable.

- [ ] **Step 3: `contrast`** (CSS): for rules that set both `color` and `background-color` to values computable without cascade (hex, `rgb()`, named colors, and CSS variables resolved from `:root`), compute the WCAG ratio; score = share of such pairs ≥ 4.5 (large text ≥ 3). If fewer than 3 computable pairs, return `null` (excluded from the a11y part rather than guessed).

- [ ] **Step 4: `css-proxies`** (CSS): counts distinct `font-size` values (fewer is better, ideal ≤ 7), distinct text colors (ideal ≤ 8), use of CSS custom properties for colours (share of colour declarations that use `var(--…)`), presence of a spacing scale (share of `margin`/`padding`/`gap` values that come from a small set of repeated values), consistent `border-radius` (≤ 4 distinct values). Score = mean of the five normalised sub-scores. This is a **proxy** for design consistency, not design quality.

- [ ] **Step 5: `code-hygiene`** (JS via `acorn`, plus file listing): detect assignments to `innerHTML`/`outerHTML` and calls to `insertAdjacentHTML`/`document.write` whose argument is not a string literal (unsafe-HTML count); `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource`/`eval`/`new Function`/`alert`/`confirm`/`prompt`/`window.open` usage (also feeds the `safe` gate); `console.*` calls; files not referenced from `index.html` (dead files); the largest single file in bytes.

- [ ] **Step 6: `language`** (HTML text and JS string literals): jargon hits from a fixed list (`API`, `JSON`, `cursor`, `null`, `undefined`, `NaN`, `payload`, `endpoint`, `HTTP`, raw error codes like `HL_` and `VALIDATION_FAILED`, `[object Object]`) in **user-visible strings** (text nodes and string literals that are assigned to `textContent`); share of values formatted for humans (dates through `Intl.DateTimeFormat`/`toLocale*`, not ISO strings rendered directly). Returns a jargon count and a boolean for human-formatted dates.

**Done when:** `analyzeStatic` never throws on malformed input (a parse failure yields score 0 and evidence `unparseable`), and runs in under 1 s for a 300 KB project.

---

### Task BV-5.8: Objective scorer

**Files:**

- Create: `functions/src/modules/generation/variants/scoring/score-candidate.ts`
- Create: `functions/src/modules/generation/variants/scoring/formulas.ts`

**Interfaces:**

- Consumes: BV-5.3–5.7 outputs, `SCORE_WEIGHTS`, `Checklist`.
- Produces:
  - `interface ObjectiveScore { gates: GateResult[]; eligible: boolean; parts: Record<ScorePart, { det: number; detMax: number; judgeMax: number }>; checklist: ChecklistResult[]; judgeInput: JudgeCandidateInput }`
  - `scoreObjective(i: { files; ops; checklist; calendarCount; outcomeOk: boolean }): Promise<ObjectiveScore>` (orchestrates inliner → scenarios → gates → probes → static)

- [ ] **Step 1: How each part is built.** The deterministic share of each part and the share left for the judge (the judge never gets more than 30 points in total):

| Part            | Max | Deterministic points (`detMax`) | Judge points (`judgeMax`) | Deterministic formula                                                                                                                                                                                                                                                                        |
| --------------- | --- | ------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dataAccuracy`  | 20  | 20                              | 0                         | `20 × (0.6·fieldCoverage + 0.2·nullHandling + 0.2·noGarbage)`: coverage from the `rendersFields` probes (and the main-label field if the checklist has none), null handling from the adversarial and null records, `noGarbage` = no `undefined`/`null`/`NaN`/`[object` in any run's text     |
| `stateHandling` | 15  | 15                              | 0                         | `15 × weighted mean` of `state.loading`, `state.empty`, `state.error`, and the baseline paging/date-range probe                                                                                                                                                                              |
| `request`       | 15  | up to 15, scaled                | up to 7.5                 | `15 × Σ(weight × score) / Σ(weight)` over probe items; if there are judge items, probe items scale to `15 − 7.5·(judgeWeight/totalWeight)` and the judge fills the rest, capped at 7.5                                                                                                       |
| `visual`        | 20  | 8                               | 12                        | `8 × css-proxies score`                                                                                                                                                                                                                                                                      |
| `clarity`       | 10  | 4                               | 6                         | `4 × (0.5·jargonFree + 0.3·humanDates + 0.2·hasHeadlineSummary)`; `jargonFree = max(0, 1 − 0.2·jargonHits)`; `hasHeadlineSummary` = an `h1`/`h2` or summary strip above the data in the `data` run                                                                                           |
| `a11y`          | 10  | 10                              | 0                         | `10 × (0.6·a11y + 0.4·responsive)`; `contrast` (if computable) replaces 0.3 of the a11y share                                                                                                                                                                                                |
| `robustness`    | 10  | 10                              | 0                         | `10 × (0.4·noUnsafeHtml + 0.3·renderBudget + 0.3·tidy)`: `renderBudget` = 1 when `domNodeCount ≤ 4000` and `renderMs ≤ 2000` for the 100-row render (a bonus scenario run only for list apps: fixture A repeated to 100 rows), else scaled down; `tidy` = no console noise and no dead files |

Judge ceiling check: 12 + 6 + 7.5 = **25.5 of 100**, under the 30-point design cap (D11).

- [ ] **Step 2: Flow.**

```ts
async scoreObjective(i) {
  const inlined = inlineProject(i.files);
  const wanted = scenariosFor(i.checklist);
  const obs = 'html' in inlined
    ? await runScenarios({ files: i.files, calendarCount: i.calendarCount, wanted })
    : new Map();                                   // nothing to run; validOutput gate fails
  const fx = fixturesFor({ calendarCount: i.calendarCount });
  const ctx: ProbeContext = { obs, fixtures: fx, files: i.files };
  const gates = runGates({ ...i, obs, fx, inlined, st: analyzeStatic(i.files) });
  const checklist = evaluateChecklist(i.checklist, ctx);
  return assembleParts({ gates, checklist, st, obs, i });          // pure, formulas.ts
}
```

- [ ] **Step 3: Judge input.** `judgeInput` is the anonymisable bundle for the judge (BV-6.1): candidate sources trimmed to `judgeSourceBudgetBytes` (30 KB; order `index.html`, CSS, then JS; each file truncated at a line boundary with a marker), the visible text of the `data` run (first 3,000 characters), the list of judge-type checklist items, and the computed objective facts (counts only).

- [ ] **Step 4: Failure behaviour.** A scenario that fails or times out gives its probes 0 credit (never a thrown error). If **all** scenarios fail the `boots` gate fails and the candidate is ineligible. `scoreObjective` is bounded by `scoringTimeoutMs` (45 s); at the deadline it returns what it has with the remaining probes at 0 and `evidence: 'timed out'`.

**Done when:** the same files, checklist and calendar count always give identical objective points; the part maxima sum to 100; the judge share is at most 25.5.
