# FV-7 — What was not carried over (as built)

The choice UI, progress, problems, fallback notice, and single-preview swap are in the app. The hardening and worker tasks from the original plan are not a finished checklist.

## Present

- Leave-while-building warning for a variants run (`useGeneration`).
- Refresh while `awaiting_selection` reopens the choice when `baseSnapshotId` still matches (`generation.store` `hydrate`).
- Refresh after an `interrupted` run calls `GET …/variants` and opens the choice when `top` is non-empty.
- Select error mapping for project changed, missing or unselectable options, in-progress, and a repeated select.
- Scores are text plus a bar. The top pick is a badge with text, not colour alone.
- One iframe. Candidate files are read with `getDocs`, not a listener.

## Not built

- The full state matrix (light/dark, 390px and 1440px) is not recorded as a completed audit in this folder.
- Focus does not move to a choice heading, and readiness is not announced in its own live region. Progress is `aria-live="polite"`. The toggle is a radiogroup.
- `Escape` does not close the double-check.
- Two-iframe memory measurement does not apply. The bundle is not split behind a lazy stage chunk.
- The emulator smoke checklist (fake provider, fallbacks, cancel, discard, privacy after select) is not recorded here.
- Cloud Tasks entry (original FV-7.5) is not built. Progress comes from SSE. Closing the tab during the build stops the run (backend D36). `GenerationSnapshot.variants.progress` is not filled from a run document.
- `docs/11-design-system.md`, `docs/06-frontend-system-design.md`, and `docs/07-end-to-end-system-design.md` were not updated for this UI.

## Worker entry, if it is added later

Views can stay. The store would need a detached start (`202` instead of SSE) and a snapshot field for phase and candidate stages, because `VariantsProgress` already reads `state.variants.phase`. The leave-dialog text would change, because a detached run would keep going. Single generations would stay on SSE.
