# FV-6 — Confirmation and handoff (as built)

There is no confirmation screen and no Continue button. After a successful select, the chat shows one line and the preview keeps the chosen files until the project snapshot arrives.

## Confirmation line

`ChatPanel.vue`, when `variants.confirmation` is set:

> You picked Option N. Score X. This is now your app.

The line does not name the direction. It does not mention the other option. It is not a focus target and it is not announced in a live region.

`confirmSelect` fills `confirmation` from the chosen option (`label` is `Option ${rank}`) and the returned `snapshotSeq`, then dispatches `variants-selected`, which marks the generation `completed`. `VariantsChat` unmounts its choice block because status is no longer `awaiting_selection`. The other option's `OptionView` is dropped from `options` immediately (the store keeps a one-element list of the chosen option until `release`).

## Preview during the handoff

`PreviewPanel` uses `confirmation.files` only while the project `snapshotSeq` is still 0. Once the project listener reports a snapshot, the preview returns to `ws.files`.

## What is not wired

`requestHandoff` and `finishHandoff` on `variants.store` are unused. `finishHandoff` would release option memory, clear the generation store, open `index.html`, and set the mobile tab to Preview. Nothing calls it, so:

- The confirmation line stays until the next submit (the session watcher releases it when status becomes `submitting`), a discard, or leaving the project (`useGeneration` teardown calls `release`).
- The editor is not opened on `index.html` and the mobile tab is not forced to Preview as part of the pick.

## Follow-ups

After the snapshot exists, `snapshotSeq > 0`, so the next prompt is a normal generation. The backend sends `not_first` when variants are not admitted. `FallbackNotice` hides that reason. History shows the one generation snapshot. The chat shows the owner's prompt and the assistant line the backend wrote on select.
