import { stageLabel } from "@/features/variants/variants.labels";
import type { GenerationState } from "./generation.reducer";

type LabelInput = Pick<
  GenerationState,
  "status" | "phase" | "streamingPath" | "origin"
> &
  Partial<Pick<GenerationState, "mode" | "variants">>;

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
    case "awaiting_selection":
      return "Choose a version";
    case "streaming":
      if (s.mode === "variants") return stageLabel(s.variants?.phase ?? null);
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
  s: Pick<GenerationState, "status" | "error" | "mode">,
): string | null {
  const variants = s.mode === "variants";
  switch (s.status) {
    case "failed":
      return variants
        ? "We couldn't build your options."
        : (s.error?.message ?? "Generation failed.");
    case "cancelled":
      return variants ? "Stopped building options." : "Generation cancelled.";
    case "interrupted":
      return variants
        ? "The connection was lost while building your options."
        : (s.error?.message ?? "The connection was lost during generation.");
    default:
      return null;
  }
}
