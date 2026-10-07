# FV-2 — State and lifecycle (as built)

The generation store tracks a variants run and enters `awaiting_selection` when options are ready. `variants.store` loads those options and handles the pick. There is no client status named `choosing`.

## Generation state

`frontend/src/features/workspace/stores/generation.reducer.ts`

```ts
export type GenerationStatus /* existing */ = 'awaiting_selection';
export type FallbackReason =
  | 'disabled'
  | 'budget'
  | 'user_limit'
  | 'global_limit'
  | 'busy'
  | 'not_first';
export type VariantsPhase = 'checklist' | 'generating' | 'scoring' | 'judging' | 'ranking';

export interface VariantsProgress {
  phase: VariantsPhase | null;
  candidates: Readonly<Record<string, string>>;
  top: readonly RankedEntry[] | null;
  notice: 'only_one_option' | 'unjudged' | null; // stored, not shown
}
```

`GenerationState` also has `mode: 'single' | 'variants' | null` and `fallbackReason`.

Events:

- `generation.started` stores `mode` and `fallbackReason`, and creates `variants` progress when `mode === 'variants'`.
- `variants.phase` sets the phase. `candidate.progress` sets that candidate's stage. The progress view does not render per-candidate stages.
- `variants.ready` sets status `awaiting_selection`, clears the phase, and stores `top` and `notice`.

Actions:

- `variants-loaded` moves `interrupted`, `awaiting_selection`, `reconciling`, or `failed` to `awaiting_selection` when `top` is non-empty.
- `variants-selected` sets `completed` from `SelectCandidateResult`.
- `isActive` and `isTerminal` do not include `awaiting_selection`. `isAwaitingSelection` does.

## Hydrate and recovery

`generation.store` `hydrate`:

- A variants snapshot with status `awaiting_selection`, no resolution, and `variants.baseSnapshotId` equal to the project's latest snapshot is attached and reconciled. A different base snapshot is ignored.
- An `interrupted` variants snapshot is attached, then `recoverVariants` calls `getVariantsResult`. A non-empty `top` dispatches `variants-loaded`.
- A `failed` snapshot is not hydrated on page load. If a `variants-loaded` action arrives while status is already `failed`, the reducer does accept it.

Reconcile of a still-active stream maps a persisted `awaiting_selection` onto the same client status and keeps any `top` already on the snapshot.

## variants.store

`frontend/src/features/variants/stores/variants.store.ts`

```ts
interface OptionView {
  entry: RankedEntry;
  files: PreviewFile[] | null;
  state: 'loading' | 'ready' | 'error' | 'expired';
}
```

Public state: `options`, `selectedId`, `loadState`, `blocked`, `selecting`, `pendingId`, `discarding`, `confirmation`, `handoffPending`.

- `load` uses the stream's `top` when it is present. Otherwise it calls `getVariantsResult`. It fetches each option's files in parallel. Zero ops marks that option `expired`. If every option is expired, `blocked` becomes `expired`. The selected id defaults to the top pick (`defaultOptionId`).
- `choose(id)` only changes which option is selected. It does not select for commit.
- `beginSelect` sets `pendingId` (the double-check). If `DOUBLE_CHECK_BEFORE_SELECT` is false, it commits immediately.
- `confirmSelect` calls `selectCandidate`, retries once on `NETWORK` or `TIMEOUT`, stores `confirmation`, and dispatches `variants-selected`.
- `discard` calls `discardGeneration`, seeds the composer with the same prompt, releases option memory, and clears the generation store.
- `release` drops options, confirmation, and the load context. `WorkspacePage` teardown calls it.

Select errors:

| Error                                                         | Behaviour                         |
| ------------------------------------------------------------- | --------------------------------- |
| `NETWORK` or `TIMEOUT`                                        | One automatic retry, then a toast |
| `CANDIDATE_NOT_SELECTABLE` with `reason: project_changed`     | `blocked = 'project_changed'`     |
| `CANDIDATE_NOT_SELECTABLE` or `CANDIDATE_NOT_FOUND`           | `blocked = 'expired'`             |
| `GENERATION_IN_PROGRESS`                                      | Toast, choice stays open          |
| `GENERATION_NOT_AWAITING_SELECTION` and resolution `selected` | Confirmation line for that option |
| `GENERATION_NOT_AWAITING_SELECTION` otherwise                 | Toast, release, clear             |

`requestHandoff` and `finishHandoff` are on the store. No component calls them. After a successful pick the confirmation line stays until the next submit, discard, or leaving the project.

## Session wiring

`useVariantsSession` watches status, generation id, and `top.length`. On `awaiting_selection` with no confirmation it calls `variants.load`. A new `submitting` status releases a leftover confirmation.

## Leave guard and composer

`useGeneration` `onBeforeRouteLeave`: while the run is active, started in this tab, and `mode === 'variants'`, the dialog says leaving stops the build. `awaiting_selection` is not active, so it does not prompt. `beforeunload` still fires for any active local run, without custom variants text.

`ChatPanel` stays mounted. While `awaiting_selection`, the composer's blocked reason is "Choose one of the options first." The composer can still cancel a run whose status is `streaming` or `reconciling`. Stop in `VariantsProgress` calls the same `generation.cancel()`.
