import { createParser, type EventSourceMessage } from "eventsource-parser";
import { LIMITS } from "@/contracts/limits";
import {
  GenerationEventSchema,
  isTerminalEvent,
  type GenerationEvent,
} from "@/contracts/sse";
import {
  apiUrl,
  authorizedHeaders,
  combineSignals,
  parseErrorResponse,
  toTransportError,
} from "@/lib/http";

export interface StreamGenerationOptions {
  projectId: string;
  clientRequestId: string;
  prompt: string;
  signal: AbortSignal;
  onEvent: (event: GenerationEvent) => void;
  watchdogMs?: number;
  onInvalidEvent?: (sample: string) => void;
}

export type StreamEndReason =
  | "terminal"
  | "closed"
  | "watchdog"
  | "network"
  | "aborted";

export interface StreamOutcome {
  terminal: boolean;
  reason: StreamEndReason;
}

/**
 * POSTs the prompt to the `generate` function and consumes SSE protocol v1 (07 §3.2).
 * Pre-stream failures throw ApiError; once streaming, the outcome says why the stream ended.
 */
export async function streamGeneration(
  o: StreamGenerationOptions,
): Promise<StreamOutcome> {
  const watchdogMs = o.watchdogMs ?? LIMITS.sseWatchdogMs;
  const watchdog = new AbortController();
  const signal = combineSignals([o.signal, watchdog.signal]);

  let res: Response;
  try {
    res = await fetch(
      apiUrl(
        "generate",
        `/v1/projects/${encodeURIComponent(o.projectId)}/generations`,
      ),
      {
        method: "POST",
        headers: {
          ...(await authorizedHeaders()),
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientRequestId: o.clientRequestId,
          prompt: o.prompt,
        }),
        signal,
        cache: "no-store",
      },
    );
  } catch (error) {
    throw toTransportError(error, o.signal);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !contentType.includes("text/event-stream") || !res.body) {
    throw await parseErrorResponse(res);
  }

  let terminal = false;
  let warned = false;
  let timer = setTimeout(() => watchdog.abort(), watchdogMs);
  const parser = createParser({
    onEvent(message: EventSourceMessage) {
      let json: unknown = null;
      try {
        json = JSON.parse(message.data);
      } catch {
        json = null;
      }
      const parsed = GenerationEventSchema.safeParse(json);
      if (!parsed.success) {
        // Unknown event types and invalid payloads are ignored (forward compatible), reported once.
        if (!warned) o.onInvalidEvent?.(message.data.slice(0, 200));
        warned = true;
        return;
      }
      if (isTerminalEvent(parsed.data)) terminal = true;
      o.onEvent(parsed.data);
    },
  });

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      clearTimeout(timer);
      timer = setTimeout(() => watchdog.abort(), watchdogMs);
      parser.feed(value);
      if (terminal) break; // the server ends the response right after the terminal event
    }
  } catch {
    if (o.signal.aborted) return { terminal, reason: "aborted" };
    if (watchdog.signal.aborted) return { terminal, reason: "watchdog" };
    return { terminal, reason: "network" };
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
  return { terminal, reason: terminal ? "terminal" : "closed" };
}
