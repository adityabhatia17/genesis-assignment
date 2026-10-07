# FV-4 — Progress and problems (as built)

Progress and problems render inside the chat. They do not replace the workspace.

## Where it mounts

`ChatPanel` shows `VariantsChat` when `mode === 'variants'` and status is one of `submitting`, `streaming`, `reconciling`, `cancelling`, `awaiting_selection`, `failed`, `cancelled`, `interrupted`.

`VariantsChat` then picks:

- `VariantsProblem` when `problemKind(state)` is set, or when the store is `blocked` (`project_changed`, `expired`, `unavailable`).
- Else `VariantsProgress` while status is `submitting`, `streaming`, `reconciling`, or `cancelling`.
- Else the choice block when status is `awaiting_selection` (see [`05`](05-choice-and-selection.md)).

`WorkspacePage` does not swap `WorkspaceLayout` for a stage. `showStage` does not exist.

## Progress

`VariantsProgress.vue` reads `state.variants.phase`.

- A spinner and the current stage label. While `cancelling`, the label is "Stopping…".
- A five-step list from `STAGE_ORDER`. The current and earlier steps use the foreground colour and a dot. Later steps are muted. The dot is `aria-hidden`. The region is `aria-live="polite"`.
- "This usually takes two to three minutes."
- After `LONG_WAIT_MS` (4 minutes) from `startedAt`: "This is taking longer than usual."
- Stop calls `generation.cancel()`. It is disabled while `submitting` or `cancelling`.

The view does not show "N of 4 versions drafted" and does not show per-candidate stages.

## Problems

`problemKind` in `variants.labels.ts`:

| State                                              | Kind             |
| -------------------------------------------------- | ---------------- |
| `cancelled`                                        | `cancelled`      |
| `interrupted`                                      | `interrupted`    |
| `failed` + `GENERATION_INVALID_OUTPUT`             | `none_qualified` |
| `failed` + `LLM_RATE_LIMITED` or `LLM_UNAVAILABLE` | `provider_busy`  |
| other `failed`                                     | `failed`         |
| not a variants run                                 | `null`           |

Copy is `PROBLEM_COPY` in the same file. `none_qualified` reads "We couldn't finish your options" / "Nothing was ready to show." It does not say a version was not good enough.

Actions in `VariantsProblem`:

- `expired` and `project_changed`: "Start again". If options were loaded, that discards the run. Otherwise it prefills the composer and clears generation state.
- Other kinds: "Try again" (`generation.retry()`, same prompt, new request). `cancelled` also has Dismiss.

## Fallback notice

`FallbackNotice` is mounted from `LiveAssistantMessage` only when `mode === 'single'`. Wording is `fallbackNotice()`:

- `budget`, `global_limit`: "Showing one version for now. Side-by-side options are paused for today."
- `user_limit`: "You've used today's side-by-side builds, so this is a single version."
- `busy`: "We're busy right now, so this is a single version."
- `disabled`, `not_first`, and `null`: no notice.

A `429` from the normal generation limits stays on the existing toast path.
