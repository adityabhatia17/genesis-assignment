import { createPinia, setActivePinia } from "pinia";
import type { GenerationEvent } from "@/contracts/sse";
import { ApiError } from "@/lib/http";
import type { GenerationSnapshot } from "@/features/workspace/stores/generation.reducer";
import { events, FAILED_WITH_PARTIAL, HAPPY } from "../../../fixtures/sse";

const stream = vi.fn();
const cancel = vi.fn();
const apply = vi.fn();
const discard = vi.fn();
let watcher: {
  next(s: GenerationSnapshot | null): void;
  error(e: Error): void;
} | null = null;

vi.mock("vue-sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/ids", () => ({ newId: () => "g1" }));
vi.mock("@/services/api/generation-stream", () => ({
  streamGeneration: (...a: unknown[]) => stream(...a) as unknown,
}));
vi.mock("@/services/api/generations.api", () => ({
  cancelGeneration: (...a: unknown[]) => cancel(...a) as unknown,
  applyGeneration: (...a: unknown[]) => apply(...a) as unknown,
  discardGeneration: (...a: unknown[]) => discard(...a) as unknown,
}));
vi.mock("@/services/firestore/generations.repo", () => ({
  watchGeneration: (_u: string, _p: string, _g: string, w: typeof watcher) => {
    watcher = w;
    return () => (watcher = null);
  },
}));

const { useGenerationStore } =
  await import("@/features/workspace/stores/generation.store");

type StreamArgs = {
  onEvent: (e: GenerationEvent) => void;
  signal: AbortSignal;
};
const replay = (
  list: GenerationEvent[],
  outcome: { terminal: boolean; reason: string },
) =>
  stream.mockImplementationOnce((o: StreamArgs) => {
    list.forEach(o.onEvent);
    return Promise.resolve(outcome);
  });
const snapshot = (over: Partial<GenerationSnapshot>): GenerationSnapshot => ({
  id: "g1",
  status: "streaming",
  prompt: "Build it",
  error: null,
  partial: null,
  result: null,
  heartbeatAtMs: Date.now(),
  ...over,
});

describe("generation store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    watcher = null;
  });

  it("streams to completion and emits editor events", async () => {
    const store = useGenerationStore();
    store.bindProject("u1", "p1");
    const started: string[] = [];
    store.bus.on("file-start", ({ path }) => started.push(path));
    const ended = vi.fn();
    store.bus.on("end", ended);
    replay(events("g1", HAPPY), { terminal: true, reason: "terminal" });
    await store.start("Build it");
    expect(store.state.status).toBe("completed");
    expect(started).toEqual(["index.html", "app.js"]);
    expect(ended).toHaveBeenCalledWith({ outcome: "completed" });
  });

  it("reconciles from Firestore when the stream drops", async () => {
    const store = useGenerationStore();
    store.bindProject("u1", "p1");
    replay(events("g1", HAPPY).slice(0, 7), {
      terminal: false,
      reason: "network",
    });
    await store.start("Build it");
    expect(store.state.status).toBe("reconciling");
    watcher?.next(
      snapshot({
        status: "interrupted",
        partial: { stagedPaths: ["index.html"], applyable: true },
      }),
    );
    expect(store.state).toMatchObject({
      status: "interrupted",
      partial: { applyable: true },
    });
    expect(watcher).toBeNull(); // stopped listening once terminal
  });

  it("attaches to the generation another tab is running", async () => {
    const store = useGenerationStore();
    store.bindProject("u1", "p1");
    stream.mockRejectedValueOnce(
      new ApiError({
        code: "GENERATION_IN_PROGRESS",
        message: "busy",
        status: 409,
        retryable: true,
        details: { activeGenerationId: "g0" },
      }),
    );
    await store.start("Build it");
    expect(store.state).toMatchObject({
      status: "reconciling",
      origin: "remote",
      generationId: "g0",
    });
  });

  it("applies a partial result", async () => {
    const store = useGenerationStore();
    store.bindProject("u1", "p1");
    replay(events("g1", FAILED_WITH_PARTIAL), {
      terminal: true,
      reason: "terminal",
    });
    await store.start("Build it");
    apply.mockResolvedValueOnce({
      snapshotId: "s5",
      snapshotSeq: 5,
      appliedPaths: ["index.html"],
      deletedPaths: [],
    });
    await store.applyPartial();
    expect(apply).toHaveBeenCalledWith("p1", "g1");
    expect(store.state).toMatchObject({
      status: "completed",
      partial: null,
      result: { snapshotSeq: 5 },
    });
  });

  it("cancels, falling back to Firestore when no terminal event arrives", async () => {
    vi.useFakeTimers();
    const store = useGenerationStore();
    store.bindProject("u1", "p1");
    let signal: AbortSignal | null = null;
    stream.mockImplementationOnce((o: StreamArgs) => {
      signal = o.signal;
      events("g1", HAPPY).slice(0, 3).forEach(o.onEvent);
      return new Promise((resolve) =>
        o.signal.addEventListener("abort", () =>
          resolve({ terminal: false, reason: "aborted" }),
        ),
      );
    });
    void store.start("Build it");
    await vi.advanceTimersByTimeAsync(0);
    cancel.mockResolvedValueOnce({ status: "cancelling" });
    const cancelling = store.cancel();
    await vi.advanceTimersByTimeAsync(5_001);
    await cancelling;
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    expect(store.state.status).toBe("reconciling");
    watcher?.next(snapshot({ status: "cancelled", partial: null }));
    expect(store.state.status).toBe("cancelled");
    vi.useRealTimers();
  });

  it("hydrates only running or unresolved generations", () => {
    const store = useGenerationStore();
    store.bindProject("u1", "p1");
    store.hydrate(snapshot({ id: "old", status: "completed" }));
    expect(store.state.status).toBe("idle");
    store.hydrate(
      snapshot({
        id: "g7",
        status: "interrupted",
        partial: { stagedPaths: ["a.js"], applyable: true },
      }),
    );
    expect(store.state).toMatchObject({
      status: "interrupted",
      generationId: "g7",
    });
  });
});
