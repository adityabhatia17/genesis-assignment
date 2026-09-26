import type { GenerationEvent } from "@/contracts/sse";

type Draft = { type: GenerationEvent["type"]; data: unknown };

/** Builds a valid protocol-v1 event sequence (seq from 1) like the backend's fake provider emits. */
export function events(
  generationId: string,
  drafts: Draft[],
): GenerationEvent[] {
  return drafts.map(
    (d, i) =>
      ({
        v: 1,
        seq: i + 1,
        generationId,
        ts: 1_000 + i,
        ...d,
      }) as GenerationEvent,
  );
}

export const HAPPY: Draft[] = [
  {
    type: "generation.started",
    data: {
      projectId: "p1",
      model: "claude-opus-5",
      promptVersion: "v1",
      startedAt: "2026-10-01T00:00:00Z",
    },
  },
  { type: "generation.phase", data: { phase: "thinking" } },
  { type: "assistant.thinking", data: { text: "Plan: list contacts." } },
  { type: "assistant.delta", data: { text: "Building a " } },
  { type: "assistant.delta", data: { text: "contact list." } },
  {
    type: "file.started",
    data: { path: "index.html", language: "html", op: "write" },
  },
  { type: "file.delta", data: { path: "index.html", text: "<!DOCTYPE html>" } },
  {
    type: "file.completed",
    data: {
      path: "index.html",
      status: "valid",
      sizeBytes: 15,
      sha256: "a".repeat(64),
      issues: [],
    },
  },
  {
    type: "file.started",
    data: { path: "app.js", language: "javascript", op: "write" },
  },
  { type: "file.delta", data: { path: "app.js", text: "let x = ;" } },
  {
    type: "file.completed",
    data: {
      path: "app.js",
      status: "rejected",
      sizeBytes: 9,
      sha256: "b".repeat(64),
      issues: [
        {
          code: "JS_SYNTAX",
          message: "Unexpected token",
          severity: "error",
          path: "app.js",
        },
      ],
    },
  },
  { type: "heartbeat", data: {} },
  { type: "generation.phase", data: { phase: "committing" } },
  {
    type: "generation.completed",
    data: {
      snapshotId: "s4",
      snapshotSeq: 4,
      changedPaths: ["index.html"],
      deletedPaths: [],
      rejected: [
        {
          path: "app.js",
          issues: [
            {
              code: "JS_SYNTAX",
              message: "Unexpected token",
              severity: "error",
            },
          ],
        },
      ],
      warnings: [],
      noChanges: false,
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUsd: 0.01,
      },
      durationMs: 1200,
    },
  },
];

export const FAILED_WITH_PARTIAL: Draft[] = [
  HAPPY[0]!,
  HAPPY[5]!,
  HAPPY[6]!,
  HAPPY[7]!,
  {
    type: "generation.failed",
    data: {
      error: {
        code: "LLM_UNAVAILABLE",
        message: "The AI service is unavailable right now.",
        retryable: true,
      },
      partial: { stagedPaths: ["index.html"], applyable: true },
    },
  },
];

/** Serializes events as the server writes them (07 §3.2 frame format). */
export const toSse = (list: GenerationEvent[]): string =>
  list
    .map(
      (e) => `event: ${e.type}\nid: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`,
    )
    .join("");
