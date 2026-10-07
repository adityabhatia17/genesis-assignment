# FV-3 — Preview (as built)

There is one sandbox preview. While the owner is choosing, that preview shows the selected option. It does not mount a second iframe.

## useSandboxPreview

`frontend/src/features/workspace/preview/useSandboxPreview.ts`

`PreviewPanel` calls it with the workspace project id, the HighLevel connection context, `debounceMs: 150`, and the webhook relay. The composable owns compile, nonce, bridge, logs, and calls. It does not import the workspace store.

Bridge budgets are unchanged: 120 calls per minute and 6 in flight, on the single bridge.

## What the preview shows

`PreviewPanel.vue` picks the file list:

1. While `mode === 'variants'` and status is `awaiting_selection`, the selected option's overlaid files.
2. Else, if a confirmation is stored and the project snapshot is still 0, the chosen option's files (so the preview does not flash empty before Firestore delivers the commit).
3. Else, the project's files.

The toolbar label while choosing is `Option N of M · preview only`. While the run is still building it is `Building your options`, and the frame shows that empty state.

On a narrow viewport (`< 1024px`) an `OptionToggle` is also rendered above the frame. On a wide viewport the toggle is only in the chat. Both toggles call `variants.choose`, so they stay on the same option.

Reload, expand, the console drawer, the HighLevel-not-connected alert, and the location-mismatch alert are the existing preview controls. Connect uses `hl.connect('/projects/:id')`.

There is no `CandidatePreview.vue`. Option code goes through the same `compilePreview` and bridge path as project files.
