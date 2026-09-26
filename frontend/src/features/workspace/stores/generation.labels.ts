import type { GenerationState } from "./generation.reducer";

type LabelInput = Pick<
  GenerationState,
  "status" | "phase" | "streamingPath" | "origin"
>;

/** Plain, factual progress text for the status pill and the live message. */
export function phaseLabel(s: LabelInput): string | null {
  switch (s.status) {
    case "submitting":
      return "Starting…";
    case "cancelling":
      return "Stopping…";
    case "reconciling":
      return s.origin === "remote"
        ? "Generating in another tab…"
        : "Reconnecting…";
    case "streaming":
      switch (s.phase) {
        case "context":
          return "Reading project…";
        case "thinking":
          return "Planning…";
        case "writing":
          return s.streamingPath
            ? `Writing ${s.streamingPath}…`
            : "Writing files…";
        case "validating":
          return "Checking files…";
        case "committing":
          return "Saving…";
        default:
          return "Starting…";
      }
    default:
      return null;
  }
}

export function outcomeTitle(
  s: Pick<GenerationState, "status" | "error">,
): string | null {
  switch (s.status) {
    case "failed":
      return s.error?.message ?? "Generation failed.";
    case "cancelled":
      return "Generation cancelled.";
    case "interrupted":
      return s.error?.message ?? "The connection was lost during generation.";
    default:
      return null;
  }
}
