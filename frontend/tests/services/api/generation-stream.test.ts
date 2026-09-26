// @vitest-environment node
import type { GenerationEvent } from "@/contracts/sse";
import { configureHttp } from "@/lib/http";
import { streamGeneration } from "@/services/api/generation-stream";
import { events, HAPPY, toSse } from "../../fixtures/sse";

/** A response body that yields `text` in random-sized byte chunks (like a real network). */
function sseResponse(text: string, { close = true } = {}): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        if (close) controller.close();
        return;
      }
      const size = 1 + Math.floor(Math.random() * 40);
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

const options = (
  onEvent: (e: GenerationEvent) => void,
  signal = new AbortController().signal,
) => ({
  projectId: "p1",
  clientRequestId: "g1",
  prompt: "Build it",
  signal,
  onEvent,
});

describe("streamGeneration", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    configureHttp({
      baseUrls: {
        api: "https://fn.test/api",
        generate: "https://fn.test/generate",
      },
      getIdToken: () => Promise.resolve("t"),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("delivers every event in order regardless of chunk boundaries", async () => {
    const list = events("g1", HAPPY);
    for (let run = 0; run < 20; run += 1) {
      fetchMock.mockResolvedValueOnce(sseResponse(toSse(list)));
      const seen: number[] = [];
      const outcome = await streamGeneration(options((e) => seen.push(e.seq)));
      expect(outcome).toEqual({ terminal: true, reason: "terminal" });
      expect(seen).toEqual(list.map((e) => e.seq));
    }
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://fn.test/generate/v1/projects/p1/generations");
    expect((init?.headers as Record<string, string>)["Accept"]).toBe(
      "text/event-stream",
    );
  });

  it("skips unknown and malformed events (forward compatible)", async () => {
    const list = events("g1", HAPPY);
    const noise =
      'event: future.thing\ndata: {"v":1,"type":"future.thing"}\n\ndata: not json\n\n';
    fetchMock.mockResolvedValueOnce(sseResponse(noise + toSse(list)));
    const seen: string[] = [];
    const invalid = vi.fn();
    await streamGeneration({
      ...options((e) => seen.push(e.type)),
      onInvalidEvent: invalid,
    });
    expect(seen).toHaveLength(list.length);
    expect(invalid).toHaveBeenCalledTimes(1);
  });

  it("reports a stream that closes without a terminal event", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse(toSse(events("g1", HAPPY).slice(0, 5))),
    );
    await expect(streamGeneration(options(() => undefined))).resolves.toEqual({
      terminal: false,
      reason: "closed",
    });
  });

  it("aborts on silence (watchdog)", async () => {
    fetchMock.mockImplementationOnce((_url, init) =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener("abort", () =>
                controller.error(new DOMException("aborted", "AbortError")),
              );
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
      ),
    );
    await expect(
      streamGeneration({ ...options(() => undefined), watchdogMs: 20 }),
    ).resolves.toEqual({ terminal: false, reason: "watchdog" });
  });

  it("throws ApiError for JSON errors before the stream starts", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "GENERATION_IN_PROGRESS",
            message: "busy",
            retryable: true,
            details: { activeGenerationId: "g0" },
            requestId: "r",
          },
        }),
        {
          status: 409,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    await expect(
      streamGeneration(options(() => undefined)),
    ).rejects.toMatchObject({
      code: "GENERATION_IN_PROGRESS",
      details: { activeGenerationId: "g0" },
    });
  });
});
