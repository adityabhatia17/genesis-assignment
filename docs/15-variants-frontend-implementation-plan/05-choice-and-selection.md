# FV-5 — The choice and selection (as built)

The owner compares the returned options one at a time. The chat holds the toggle, the score, and the pick. The preview holds the running app.

## Score and top pick

`score-display.ts`

- `GROUP_LABELS`: Works, Looks polished, Matches your request, Easy to use.
- `groupPercent` rounds `points / max` to a percent. A zero max is 0.
- `scoreAriaLabel` names the total and each group as points out of max.

`ScoreSummary.vue` shows the integer total as `N/100` and a bar per group (`width` from `groupPercent`) with `points/max`. The list is `aria-hidden`. The wrapper's accessible name is `scoreAriaLabel`. The client does not recompute the total.

`TopPickMarker.vue` is a secondary badge, "Our top pick", with a check icon. It renders only when `topPick` is true.

`option-label.ts`: the toggle text is `Option ${rank} · ${total}`. `defaultOptionId` prefers the top pick.

Direction labels are on the ranked entry and are not rendered.

## Toggle

`OptionToggle.vue` is a `radiogroup` labelled "Versions". One button per option. Arrow keys move the selection when two options exist and the control is not locked. Locked means a double-check is open or a select is in flight.

The same component is in `VariantsChat` at every width, and in `PreviewPanel` only below 1024px.

## Choice block

`VariantsChat`, when status is `awaiting_selection` and there is no problem:

- Heading: "Choose from the two." or, when `options.length === 1`, "One option is ready." There is no quality-bar sentence and no extra Try again for the single option.
- Loading and error states for the option list, with Retry calling `variants.reload()`.
- The toggle, then `ScoreSummary` for the selected option.
- If that option's files are still loading: "Loading this version in the preview."
- If that option failed to load: "Couldn't load this version." and Retry (`variants.retryOption`).
- Otherwise "Use this version" and "Start over". Use is disabled until the selected option's files are ready.

## Double-check

`SelectDoubleCheck.vue` replaces the two buttons while `pendingId` is set.

> Use this version (score N)? The other option will be removed. You can keep changing the app in chat afterwards.

Actions: "Yes, use this version" (`confirmSelect`) and "Go back" (`cancelPending`). Go back is disabled while the request is in flight. The toggle is locked for the same reason, so the owner cannot switch options during the check.

`VariantsChat` does not listen for Escape. The preview's Escape handler only collapses an expanded frame.

## Start over

`VariantsChat` confirms with `confirmAction` ("Start over?", "These options will be removed. You can describe the app again.") and then `variants.discard()`.

## Offline

`ChatPanel` sets the composer blocked reason to "You're offline." when `useOnline()` is false. The Use and Start over buttons in `VariantsChat` are not separately tied to online state.
