# BE-4 — HighLevel client, adapters and runtime proxy

> Read [`00-overview.md`](00-overview.md) first. Design: [`../05-backend-system-design.md`](../05-backend-system-design.md) §7.4–7.7. Endpoint facts: [`../research/02-highlevel-platform.md`](../research/02-highlevel-platform.md) §5–§7. Contract: runtime manifest in `contracts/hl-runtime.ts` (BE-1.3).

**Outcome:** the seven read methods work against the sandbox through `/v1/projects/:projectId/hl/...`, returning normalized models with one pagination contract; 401s trigger one refresh + retry; HighLevel 429s are retried with backoff; prompt context can fetch bounded HighLevel metadata.

---

### Task BE-4.1: HighLevel HTTP client and error mapping

**Files:**

- Create: `functions/src/modules/highlevel/client/hl-errors.ts`, `functions/src/modules/highlevel/client/hl-http.client.ts`
- Test: `functions/test/unit/highlevel/hl-http.client.test.ts`, `functions/test/unit/highlevel/hl-errors.test.ts`

**Interfaces:**

- Produces: `class HlApiError { status; traceId; retryAfterMs }`, `sanitizeHlMessage(body)`, `hlErrorToAppError(err)`; `type HlVersion = '2021-07-28' | '2021-04-15'`, `HL_VERSION = { contacts, locations, conversations, calendars }`, `interface HlRequest`, `interface HlHttp { request(req): Promise<unknown> }`, `createHlHttpClient({ baseUrl, logger, fetchImpl?, sleep?, maxRetries? })`. A per-location proxy token bucket is out of v1 (R-B4).

- [ ] **Step 1: Write the failing tests**

`test/unit/highlevel/hl-errors.test.ts`:

```ts
import {
  HlApiError,
  hlErrorToAppError,
  sanitizeHlMessage,
} from "../../../src/modules/highlevel/client/hl-errors.js";

describe("hl error mapping", () => {
  it.each([
    [401, "HL_REAUTH_REQUIRED"],
    [403, "HL_FORBIDDEN"],
    [404, "HL_NOT_FOUND"],
    [400, "HL_BAD_REQUEST"],
    [422, "HL_BAD_REQUEST"],
    [429, "HL_RATE_LIMITED"],
    [500, "HL_UNAVAILABLE"],
    [0, "HL_UNAVAILABLE"],
  ])("%i → %s", (status, code) => {
    expect(
      hlErrorToAppError(new HlApiError(status, "x", null, null)).code,
    ).toBe(code);
  });
  it("detects missing scopes", () => {
    expect(
      hlErrorToAppError(
        new HlApiError(
          403,
          "The token is not authorized for this scope.",
          null,
          null,
        ),
      ).code,
    ).toBe("HL_SCOPE_MISSING");
  });
  it("sanitizes messages (arrays, tokens, length)", () => {
    expect(
      sanitizeHlMessage({
        message: ["email must be an email", "phone invalid"],
      }),
    ).toBe("email must be an email; phone invalid");
    expect(
      sanitizeHlMessage({
        message: "Bearer abcdefghijklmnopqrstuvwxyz0123456789 is bad",
      }),
    ).not.toContain("abcdefghijklmnop");
    expect(
      sanitizeHlMessage({ message: "x".repeat(1000) }).length,
    ).toBeLessThanOrEqual(300);
    expect(sanitizeHlMessage(null)).toBe("HighLevel request failed");
  });
});
```

`test/unit/highlevel/hl-http.client.test.ts`:

```ts
import { createHlHttpClient } from "../../../src/modules/highlevel/client/hl-http.client.js";
import { HlApiError } from "../../../src/modules/highlevel/client/hl-errors.js";
import { LocationRateLimiter } from "../../../src/modules/highlevel/client/location-rate-limiter.js";
import { createFakeClock } from "../../../src/shared/clock.js";
import { fakeLogger } from "../../helpers/fakes.js";

type Reply = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};
function scripted(replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = replies.shift() ?? { status: 500 };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: r.headers,
    });
  }) as typeof fetch;
  return { impl, calls };
}
const limiter = () =>
  new LocationRateLimiter(createFakeClock(0), {
    limit: 90,
    windowMs: 10_000,
    maxWaitMs: 0,
  });

describe("hl http client", () => {
  it("sends bearer, Version and JSON body; drops undefined query values", async () => {
    const s = scripted([{ status: 200, body: { ok: 1 } }]);
    const hl = createHlHttpClient({
      baseUrl: "https://hl.test",
      limiter: limiter(),
      logger: fakeLogger(),
      fetchImpl: s.impl,
      sleep: async () => {},
    });
    await hl.request({
      method: "POST",
      path: "/contacts/search",
      version: "2021-07-28",
      query: { a: 1, b: undefined },
      body: { x: 1 },
      accessToken: "tok",
      locationId: "loc",
    });
    const { url, init } = s.calls[0]!;
    expect(url).toBe("https://hl.test/contacts/search?a=1");
    const h = new Headers(init.headers);
    expect(h.get("authorization")).toBe("Bearer tok");
    expect(h.get("version")).toBe("2021-07-28");
    expect(h.get("content-type")).toBe("application/json");
    expect(init.body).toBe('{"x":1}');
  });
  it("retries GET on 429 honoring Retry-After, then succeeds", async () => {
    const s = scripted([
      { status: 429, headers: { "retry-after": "1" } },
      { status: 200, body: { ok: 1 } },
    ]);
    const sleeps: number[] = [];
    const hl = createHlHttpClient({
      baseUrl: "https://hl.test",
      limiter: limiter(),
      logger: fakeLogger(),
      fetchImpl: s.impl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await expect(
      hl.request({
        method: "GET",
        path: "/calendars/",
        version: "2021-04-15",
        accessToken: "t",
        locationId: "l",
      }),
    ).resolves.toEqual({ ok: 1 });
    expect(sleeps).toEqual([1000]);
  });
  it("does not retry POST after a 5xx", async () => {
    const s = scripted([
      { status: 502, body: { message: "bad gateway" } },
      { status: 200, body: {} },
    ]);
    const hl = createHlHttpClient({
      baseUrl: "https://hl.test",
      limiter: limiter(),
      logger: fakeLogger(),
      fetchImpl: s.impl,
      sleep: async () => {},
    });
    await expect(
      hl.request({
        method: "POST",
        path: "/contacts/",
        version: "2021-07-28",
        body: {},
        accessToken: "t",
        locationId: "l",
      }),
    ).rejects.toBeInstanceOf(HlApiError);
    expect(s.calls).toHaveLength(1);
  });
  it("raises HlApiError with status and trace id", async () => {
    const s = scripted([
      { status: 404, body: { message: "Contact not found", traceId: "tr-1" } },
    ]);
    const hl = createHlHttpClient({
      baseUrl: "https://hl.test",
      limiter: limiter(),
      logger: fakeLogger(),
      fetchImpl: s.impl,
      sleep: async () => {},
    });
    const err = await hl
      .request({
        method: "GET",
        path: "/contacts/x",
        version: "2021-07-28",
        accessToken: "t",
        locationId: "l",
      })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 404, traceId: "tr-1" });
  });
  it("per-location limiter rejects when the bucket is empty and waiting is not allowed", async () => {
    const lim = new LocationRateLimiter(createFakeClock(0), {
      limit: 1,
      windowMs: 10_000,
      maxWaitMs: 0,
    });
    await lim.acquire("l");
    await expect(lim.acquire("l")).rejects.toMatchObject({
      code: "HL_RATE_LIMITED",
    });
    await expect(lim.acquire("other")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement `hl-errors.ts`**

```ts
import { z } from "zod";
import { AppError } from "../../../shared/app-error.js";

export class HlApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly traceId: string | null,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = "HlApiError";
  }
}

const ErrorBody = z
  .object({
    message: z.union([z.string(), z.array(z.string())]).optional(),
    error: z.string().optional(),
    traceId: z.string().optional(),
  })
  .passthrough();

export function sanitizeHlMessage(body: unknown): string {
  const parsed = ErrorBody.safeParse(body);
  const raw = parsed.success
    ? (parsed.data.message ?? parsed.data.error)
    : undefined;
  const text = Array.isArray(raw) ? raw.join("; ") : raw;
  if (!text) return "HighLevel request failed";
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9._-]{32,}/g, "[redacted]")
    .slice(0, 300);
}

export function extractTraceId(body: unknown): string | null {
  const parsed = ErrorBody.safeParse(body);
  return parsed.success ? (parsed.data.traceId ?? null) : null;
}

export function hlErrorToAppError(err: HlApiError): AppError {
  const cause = { cause: err };
  if (err.status === 401)
    return new AppError("HL_REAUTH_REQUIRED", undefined, undefined, cause);
  if (err.status === 403)
    return new AppError(
      /scope/i.test(err.message) ? "HL_SCOPE_MISSING" : "HL_FORBIDDEN",
      undefined,
      undefined,
      cause,
    );
  if (err.status === 404)
    return new AppError("HL_NOT_FOUND", undefined, undefined, cause);
  if (err.status === 400 || err.status === 422)
    return new AppError("HL_BAD_REQUEST", err.message, undefined, cause);
  if (err.status === 429)
    return new AppError(
      "HL_RATE_LIMITED",
      undefined,
      err.retryAfterMs ? { retryAfterMs: err.retryAfterMs } : undefined,
      cause,
    );
  return new AppError("HL_UNAVAILABLE", undefined, undefined, cause);
}
```

- [ ] **Step 4: Skip the per-location proxy token bucket** — assignment bonus R-B4 is out of v1. HighLevel `429` retry in the HTTP client (Step 5) is enough.

- [ ] **Step 5: Implement `hl-http.client.ts`**

```ts
import { sleep as defaultSleep } from "../../../shared/async.js";
import type { Logger } from "../../../shared/logger.js";
import { extractTraceId, HlApiError, sanitizeHlMessage } from "./hl-errors.js";

export type HlVersion = "2021-07-28" | "2021-04-15";
export const HL_VERSION = {
  contacts: "2021-07-28",
  locations: "2021-07-28",
  conversations: "2021-04-15",
  calendars: "2021-04-15",
} as const satisfies Record<string, HlVersion>;

export interface HlRequest {
  method: "GET" | "POST" | "PUT";
  path: string;
  version: HlVersion;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  accessToken: string;
  locationId: string;
  timeoutMs?: number;
}

export interface HlHttp {
  request(req: HlRequest): Promise<unknown>;
}

export interface HlHttpOptions {
  baseUrl: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const templatePath = (path: string) =>
  path.replace(/\/[A-Za-z0-9_-]{12,}(?=\/|$)/g, "/:id");
const backoffMs = (attempt: number) =>
  Math.min(2_000, 300 * 2 ** attempt) + Math.floor(Math.random() * 150);
const parseRetryAfter = (h: string | null): number | null => {
  if (!h) return null;
  const secs = Number(h);
  return Number.isFinite(secs)
    ? Math.min(10_000, Math.max(0, secs * 1000))
    : null;
};

export function createHlHttpClient(o: HlHttpOptions): HlHttp {
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => defaultSleep(ms));
  const maxRetries = o.maxRetries ?? 2;

  return {
    async request(r) {
      const url = new URL(o.baseUrl + r.path);
      for (const [k, v] of Object.entries(r.query ?? {}))
        if (v !== undefined) url.searchParams.set(k, String(v));
      const isWrite = r.method !== "GET";

      for (let attempt = 0; ; attempt += 1) {
        const started = Date.now();
        let res: Response;
        try {
          res = await doFetch(url, {
            method: r.method,
            headers: {
              Authorization: `Bearer ${r.accessToken}`,
              Version: r.version,
              Accept: "application/json",
              ...(r.body !== undefined
                ? { "Content-Type": "application/json" }
                : {}),
            },
            body: r.body !== undefined ? JSON.stringify(r.body) : undefined,
            signal: AbortSignal.timeout(r.timeoutMs ?? 15_000),
          });
        } catch {
          // Network error / timeout: a write may already have been applied, so never retry writes.
          if (!isWrite && attempt < maxRetries) {
            await sleep(backoffMs(attempt));
            continue;
          }
          throw new HlApiError(
            0,
            "Network error calling HighLevel",
            null,
            null,
          );
        }

        const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        o.logger.info("hl.call", {
          method: r.method,
          path: templatePath(r.path),
          status: res.status,
          ms: Date.now() - started,
          rateRemaining: res.headers.get("x-ratelimit-remaining"),
          dailyRemaining: res.headers.get("x-ratelimit-daily-remaining"),
        });
        if (res.ok) {
          const text = await res.text();
          return text ? (JSON.parse(text) as unknown) : null;
        }
        const body: unknown = await res.json().catch(() => null);
        const retryable = res.status === 429 || (res.status >= 500 && !isWrite);
        if (retryable && attempt < maxRetries) {
          await sleep(retryAfterMs ?? backoffMs(attempt));
          continue;
        }
        throw new HlApiError(
          res.status,
          sanitizeHlMessage(body),
          extractTraceId(body),
          retryAfterMs,
        );
      }
    },
  };
}
```

- [ ] **Step 6: Run tests** → PASS. **Step 7: Commit** — `feat(functions): add HighLevel HTTP client with retries, limiter and error mapping`.

---

### Task BE-4.2: Cursor codec and normalizers

**Files:**

- Create: `functions/src/modules/highlevel/adapters/cursor.ts`, `functions/src/modules/highlevel/adapters/normalize.ts`
- Modify: `functions/src/shared/async.ts` (add `mapWithConcurrency`)
- Test: `functions/test/unit/highlevel/cursor.test.ts`, `functions/test/unit/highlevel/normalize.test.ts`

**Interfaces:**

- Produces: `type Cursor`, `encodeCursor(c)`, `decodeCursor(kind, raw)`; `toIso(v)`, `isoToMs(iso)`, `nullIfBlank(v)`, `str(v)`, `displayName(raw)`, `messageTypeLabel(v)`; `mapWithConcurrency(items, limit, fn)`.

- [ ] **Step 1: Tests**

```ts
// cursor.test.ts
import {
  decodeCursor,
  encodeCursor,
} from "../../../src/modules/highlevel/adapters/cursor.js";

describe("cursor codec", () => {
  it("round-trips with the right kind", () => {
    const c = encodeCursor({ k: "contacts", sa: [1712345678901, "abc"] });
    expect(decodeCursor("contacts", c)).toEqual({
      k: "contacts",
      sa: [1712345678901, "abc"],
    });
  });
  it("rejects kind mismatch and garbage as VALIDATION_FAILED", () => {
    const c = encodeCursor({ k: "messages", lmi: "m1" });
    expect(() => decodeCursor("contacts", c)).toThrow(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
    expect(() => decodeCursor("contacts", "%%%")).toThrow(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
  });
});
```

```ts
// normalize.test.ts
import {
  displayName,
  messageTypeLabel,
  toIso,
} from "../../../src/modules/highlevel/adapters/normalize.js";
import { mapWithConcurrency } from "../../../src/shared/async.js";

describe("normalizers", () => {
  it("converts dates to ISO", () => {
    expect(toIso(1_700_000_000_000)).toBe("2023-11-14T22:13:20.000Z");
    expect(toIso("1700000000000")).toBe("2023-11-14T22:13:20.000Z");
    expect(toIso("1700000000")).toBe("2023-11-14T22:13:20.000Z");
    expect(toIso("2026-10-01T10:00:00-05:00")).toBe("2026-10-01T15:00:00.000Z");
    expect(toIso("not a date")).toBeNull();
    expect(toIso(undefined)).toBeNull();
  });
  it("builds a non-empty display name", () => {
    expect(displayName({ firstName: "Ava", lastName: "Patel" })).toBe(
      "Ava Patel",
    );
    expect(displayName({ contactName: "Mia Kim" })).toBe("Mia Kim");
    expect(displayName({ email: "x@y.z" })).toBe("x@y.z");
    expect(displayName({})).toBe("Unnamed contact");
  });
  it("labels message types", () => {
    expect(messageTypeLabel("TYPE_SMS")).toBe("SMS");
    expect(messageTypeLabel(2)).toBeNull();
  });
  it("maps with bounded concurrency preserving order", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Implement**

`cursor.ts`:

```ts
import { z } from "zod";
import { AppError } from "../../../shared/app-error.js";

const CursorSchema = z.discriminatedUnion("k", [
  z.object({
    k: z.literal("contacts"),
    sa: z
      .array(z.union([z.string(), z.number()]))
      .min(1)
      .max(4),
  }),
  z.object({
    k: z.literal("conversations"),
    sad: z.union([z.number(), z.string()]),
  }),
  z.object({ k: z.literal("messages"), lmi: z.string().min(1) }),
]);
export type Cursor = z.infer<typeof CursorSchema>;

export const encodeCursor = (c: Cursor): string =>
  Buffer.from(JSON.stringify(c), "utf8").toString("base64url");

export function decodeCursor<K extends Cursor["k"]>(
  kind: K,
  raw: string,
): Extract<Cursor, { k: K }> {
  try {
    const parsed = CursorSchema.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
    if (parsed.k !== kind) throw new Error("cursor kind mismatch");
    return parsed as Extract<Cursor, { k: K }>;
  } catch (err) {
    throw new AppError(
      "VALIDATION_FAILED",
      "Invalid cursor",
      { field: "cursor" },
      { cause: err },
    );
  }
}
```

`normalize.ts`:

```ts
export function toIso(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v))
    return new Date(v).toISOString();
  if (typeof v !== "string" || v.trim() === "") return null;
  const s = v.trim();
  if (/^\d{13}$/.test(s)) return new Date(Number(s)).toISOString();
  if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000).toISOString();
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export const isoToMs = (iso: string): number => Date.parse(iso);

export const nullIfBlank = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

export const str = (v: unknown): string | null =>
  typeof v === "string" && v !== ""
    ? v
    : typeof v === "number"
      ? String(v)
      : null;

export function displayName(r: {
  contactName?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
}): string {
  const full = [nullIfBlank(r.firstName), nullIfBlank(r.lastName)]
    .filter(Boolean)
    .join(" ");
  return (
    nullIfBlank(r.contactName) ??
    (full || null) ??
    nullIfBlank(r.name) ??
    nullIfBlank(r.email) ??
    nullIfBlank(r.phone) ??
    "Unnamed contact"
  );
}

export function messageTypeLabel(v: unknown): string | null {
  if (typeof v !== "string" || v === "") return null;
  return v.startsWith("TYPE_") ? v.slice(5) : v;
}
```

Append to `shared/async.ts`:

```ts
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
```

- [ ] **Step 3: Run tests → PASS. Step 4: Commit** — `feat(functions): add typed opaque cursors and HighLevel normalizers`.

---

### Task BE-4.3: Core adapters (contacts, conversations, calendars, location — read-only)

**Files:**

- Create: `functions/src/modules/highlevel/adapters/context.ts`, `contacts.adapter.ts`, `conversations.adapter.ts`, `calendars.adapter.ts`, `locations.adapter.ts`
- Test: `functions/test/unit/highlevel/adapters.test.ts`, `functions/test/helpers/fake-hl.ts`

**Interfaces:**

- Consumes: `HlHttp`, `HL_VERSION`, cursor + normalizers, contracts models/params (`RuntimeParsedParams<M>`), `ConnectionProjection`.
- Produces: `interface HlCallContext { hl: HlHttp; accessToken: string; locationId: string; loadProjection(): Promise<ConnectionProjection | null> }`; `toContact`, `SingleResponse`, `listContacts`, `getContact`, `countContacts`; `listConversations`, `listMessages`; `listCalendars`, `listEvents`; `getLocation`.

- [ ] **Step 1: Fake HighLevel helper `test/helpers/fake-hl.ts`**

```ts
import type {
  HlHttp,
  HlRequest,
} from "../../src/modules/highlevel/client/hl-http.client.js";
import type { HlCallContext } from "../../src/modules/highlevel/adapters/context.js";

export function fakeHl(route: (req: HlRequest) => unknown) {
  const calls: HlRequest[] = [];
  const hl: HlHttp = {
    request: (req) => {
      calls.push(req);
      return Promise.resolve(route(req));
    },
  };
  const ctx: HlCallContext = {
    hl,
    accessToken: "tok",
    locationId: "loc_1",
    loadProjection: () =>
      Promise.resolve({
        status: "connected",
        locationId: "loc_1",
        locationName: "Demo Clinic",
        timezone: "America/New_York",
        scopes: [],
      }),
  };
  return { ctx, calls };
}
```

- [ ] **Step 2: Write the failing adapter tests**

```ts
import { decodeCursor } from "../../../src/modules/highlevel/adapters/cursor.js";
import { listContacts } from "../../../src/modules/highlevel/adapters/contacts.adapter.js";
import {
  listConversations,
  listMessages,
} from "../../../src/modules/highlevel/adapters/conversations.adapter.js";
import { listEvents } from "../../../src/modules/highlevel/adapters/calendars.adapter.js";
import { getLocation } from "../../../src/modules/highlevel/adapters/locations.adapter.js";
import { fakeHl } from "../../helpers/fake-hl.js";

const contact = (i: number) => ({
  id: `c${i}`,
  firstName: `F${i}`,
  lastName: "L",
  email: `c${i}@x.test`,
  phone: null,
  tags: ["vip", 3],
  dateAdded: "2026-09-01T10:00:00.000Z",
  searchAfter: [1_000 + i, `c${i}`],
});

describe("contacts adapter", () => {
  it("maps search request/response and paginates with searchAfter", async () => {
    const { ctx, calls } = fakeHl(() => ({
      contacts: [contact(1), contact(2)],
      total: 36,
    }));
    const page = await listContacts(ctx, { limit: 2, query: "ava" });
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/contacts/search",
      version: "2021-07-28",
    });
    expect(calls[0]!.body).toEqual({
      locationId: "loc_1",
      pageLimit: 2,
      query: "ava",
      sort: [{ field: "dateAdded", direction: "desc" }],
    });
    expect(page.items[0]).toEqual({
      id: "c1",
      name: "F1 L",
      firstName: "F1",
      lastName: "L",
      email: "c1@x.test",
      phone: null,
      companyName: null,
      tags: ["vip"],
      dateAdded: "2026-09-01T10:00:00.000Z",
    });
    expect(page.hasMore).toBe(true);
    expect(decodeCursor("contacts", page.nextCursor!)).toEqual({
      k: "contacts",
      sa: [1002, "c2"],
    });

    await listContacts(ctx, { limit: 2, cursor: page.nextCursor! });
    expect((calls[1]!.body as Record<string, unknown>)["searchAfter"]).toEqual([
      1002,
      "c2",
    ]);
  });
  it("ends pagination on a short page", async () => {
    const { ctx } = fakeHl(() => ({ contacts: [contact(1)] }));
    const page = await listContacts(ctx, { limit: 20 });
    expect(page).toMatchObject({ nextCursor: null, hasMore: false });
  });
});

describe("conversations adapter", () => {
  it("lists with startAfterDate cursor", async () => {
    const rows = [
      {
        id: "v1",
        contactId: "c1",
        fullName: "Ava",
        lastMessageBody: "hi",
        lastMessageType: "TYPE_SMS",
        lastMessageDate: 1_700_000_000_000,
        unreadCount: 2,
        sort: [1_700_000_000_000],
      },
    ];
    const { ctx, calls } = fakeHl(() => ({ conversations: rows, total: 5 }));
    const page = await listConversations(ctx, { limit: 1 });
    expect(calls[0]).toMatchObject({
      method: "GET",
      path: "/conversations/search",
      version: "2021-04-15",
      query: {
        locationId: "loc_1",
        limit: 1,
        sort: "desc",
        sortBy: "last_message_date",
      },
    });
    expect(page.items[0]).toMatchObject({
      id: "v1",
      contactName: "Ava",
      lastMessageType: "SMS",
      lastMessageDate: "2023-11-14T22:13:20.000Z",
      unreadCount: 2,
    });
    expect(decodeCursor("conversations", page.nextCursor!)).toEqual({
      k: "conversations",
      sad: 1_700_000_000_000,
    });
  });
  it.each([
    [
      "nested",
      {
        messages: {
          lastMessageId: "m2",
          nextPage: true,
          messages: [
            {
              id: "m1",
              body: "hey",
              direction: "inbound",
              messageType: "TYPE_SMS",
              dateAdded: "2026-09-01T00:00:00Z",
            },
          ],
        },
      },
    ],
    [
      "flat",
      {
        lastMessageId: "m2",
        nextPage: true,
        messages: [
          {
            id: "m1",
            body: "hey",
            direction: "inbound",
            messageType: "TYPE_SMS",
            dateAdded: "2026-09-01T00:00:00Z",
          },
        ],
      },
    ],
  ])("accepts %s message responses", async (_n, body) => {
    const { ctx } = fakeHl(() => body);
    const page = await listMessages(ctx, { conversationId: "v1", limit: 20 });
    expect(page.items[0]).toEqual({
      id: "m1",
      conversationId: "v1",
      body: "hey",
      direction: "inbound",
      type: "SMS",
      status: null,
      dateAdded: "2026-09-01T00:00:00.000Z",
    });
    expect(decodeCursor("messages", page.nextCursor!)).toEqual({
      k: "messages",
      lmi: "m2",
    });
  });
});

describe("calendars adapter", () => {
  it("fans out across active calendars and sorts events", async () => {
    const { ctx, calls } = fakeHl((req) => {
      if (req.path === "/calendars/")
        return {
          calendars: [
            { id: "k1", name: "A", isActive: true },
            { id: "k2", name: "B" },
            { id: "k3", name: "Off", isActive: false },
          ],
        };
      const id = req.query?.["calendarId"];
      return {
        events: [
          {
            id: `e-${String(id)}`,
            calendarId: id,
            title: "Visit",
            appointmentStatus: "confirmed",
            startTime:
              id === "k1" ? "2026-10-03T10:00:00Z" : "2026-10-02T10:00:00Z",
            endTime: "2026-10-03T11:00:00Z",
          },
        ],
      };
    });
    const out = await listEvents(ctx, {
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-08T00:00:00Z",
    });
    expect(out.items.map((e) => e.id)).toEqual(["e-k2", "e-k1"]);
    const eventCalls = calls.filter((c) => c.path === "/calendars/events");
    expect(eventCalls).toHaveLength(2);
    expect(eventCalls[0]!.query).toMatchObject({
      startTime: String(Date.parse("2026-10-01T00:00:00Z")),
      endTime: String(Date.parse("2026-10-08T00:00:00Z")),
    });
  });
});

describe("location adapter", () => {
  it("reads from the connection projection without calling HighLevel", async () => {
    const { ctx, calls } = fakeHl(() => ({}));
    expect(await getLocation(ctx)).toEqual({
      id: "loc_1",
      name: "Demo Clinic",
      timezone: "America/New_York",
    });
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Implement `context.ts`**

```ts
import type { ConnectionProjection } from "../connection/connection.repo.js";
import type { HlHttp } from "../client/hl-http.client.js";

export interface HlCallContext {
  readonly hl: HlHttp;
  readonly accessToken: string;
  readonly locationId: string;
  loadProjection(): Promise<ConnectionProjection | null>;
}

export const call = (ctx: HlCallContext) => ({
  accessToken: ctx.accessToken,
  locationId: ctx.locationId,
});
```

- [ ] **Step 4: Implement `contacts.adapter.ts`**

```ts
import { z } from "zod";
import type {
  Contact,
  Page,
  RuntimeParsedParams,
} from "../../../contracts/hl-runtime.js";
import { HL_VERSION } from "../client/hl-http.client.js";
import { call, type HlCallContext } from "./context.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { displayName, isoToMs, nullIfBlank, toIso } from "./normalize.js";

const RawContact = z
  .object({
    id: z.string(),
    firstName: z.unknown().optional(),
    lastName: z.unknown().optional(),
    contactName: z.unknown().optional(),
    name: z.unknown().optional(),
    email: z.unknown().optional(),
    phone: z.unknown().optional(),
    companyName: z.unknown().optional(),
    tags: z.array(z.unknown()).optional(),
    dateAdded: z.unknown().optional(),
    searchAfter: z.array(z.union([z.string(), z.number()])).optional(),
  })
  .passthrough();
type RawContact = z.infer<typeof RawContact>;

const SearchResponse = z
  .object({
    contacts: z.array(RawContact).default([]),
    total: z.number().optional(),
  })
  .passthrough();
export const SingleResponse = z.object({ contact: RawContact }).passthrough();

export function toContact(r: RawContact): Contact {
  return {
    id: r.id,
    name: displayName(r),
    firstName: nullIfBlank(r.firstName),
    lastName: nullIfBlank(r.lastName),
    email: nullIfBlank(r.email),
    phone: nullIfBlank(r.phone),
    companyName: nullIfBlank(r.companyName),
    tags: (r.tags ?? []).filter((t): t is string => typeof t === "string"),
    dateAdded: toIso(r.dateAdded),
  };
}

export async function listContacts(
  ctx: HlCallContext,
  p: RuntimeParsedParams<"contacts.list">,
): Promise<Page<Contact>> {
  const body: Record<string, unknown> = {
    locationId: ctx.locationId,
    pageLimit: p.limit,
  };
  if (p.query) body["query"] = p.query;
  body["sort"] = [{ field: "dateAdded", direction: "desc" }];
  if (p.cursor) body["searchAfter"] = decodeCursor("contacts", p.cursor).sa;

  const raw = SearchResponse.parse(
    await ctx.hl.request({
      method: "POST",
      path: "/contacts/search",
      version: HL_VERSION.contacts,
      body,
      ...call(ctx),
    }),
  );
  const last = raw.contacts.at(-1);
  const nextCursor =
    last && raw.contacts.length === p.limit
      ? encodeCursor({
          k: "contacts",
          sa: last.searchAfter ?? [
            isoToMs(toIso(last.dateAdded) ?? "1970-01-01T00:00:00Z"),
            last.id,
          ],
        })
      : null;
  return {
    items: raw.contacts.map(toContact),
    nextCursor,
    hasMore: nextCursor !== null,
  };
}

export async function countContacts(
  ctx: HlCallContext,
): Promise<number | null> {
  const raw = SearchResponse.parse(
    await ctx.hl.request({
      method: "POST",
      path: "/contacts/search",
      version: HL_VERSION.contacts,
      body: { locationId: ctx.locationId, pageLimit: 1 },
      ...call(ctx),
    }),
  );
  return raw.total ?? null;
}

export async function getContact(
  ctx: HlCallContext,
  p: RuntimeParsedParams<"contacts.get">,
): Promise<Contact> {
  const raw = SingleResponse.parse(
    await ctx.hl.request({
      method: "GET",
      path: `/contacts/${encodeURIComponent(p.contactId)}`,
      version: HL_VERSION.contacts,
      ...call(ctx),
    }),
  );
  return toContact(raw.contact);
}
```

> Spike S5 note: if HighLevel rejects the `sort` array, remove it and rely on default ordering (the `searchAfter` fallback still works because each row carries `searchAfter`).

- [ ] **Step 5: Implement `conversations.adapter.ts`**

```ts
import { z } from "zod";
import type {
  Conversation,
  Message,
  Page,
  RuntimeParsedParams,
} from "../../../contracts/hl-runtime.js";
import { HL_VERSION } from "../client/hl-http.client.js";
import { call, type HlCallContext } from "./context.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { messageTypeLabel, nullIfBlank, str, toIso } from "./normalize.js";

const RawConversation = z
  .object({
    id: z.string(),
    contactId: z.unknown().optional(),
    contactName: z.unknown().optional(),
    fullName: z.unknown().optional(),
    lastMessageBody: z.unknown().optional(),
    lastMessageType: z.unknown().optional(),
    lastMessageDate: z.unknown().optional(),
    dateUpdated: z.unknown().optional(),
    unreadCount: z.unknown().optional(),
    sort: z.array(z.union([z.number(), z.string()])).optional(),
  })
  .passthrough();
const SearchResponse = z
  .object({
    conversations: z.array(RawConversation).default([]),
    total: z.number().optional(),
  })
  .passthrough();

const RawMessage = z
  .object({
    id: z.string(),
    conversationId: z.unknown().optional(),
    body: z.unknown().optional(),
    direction: z.unknown().optional(),
    messageType: z.unknown().optional(),
    type: z.unknown().optional(),
    status: z.unknown().optional(),
    dateAdded: z.unknown().optional(),
  })
  .passthrough();
const MessagesPage = z
  .object({
    messages: z.array(RawMessage).default([]),
    nextPage: z.boolean().optional(),
    lastMessageId: z.string().optional(),
  })
  .passthrough();
const MessagesResponse = z.union([
  z.object({ messages: MessagesPage }).passthrough(),
  MessagesPage,
]);

export async function listConversations(
  ctx: HlCallContext,
  p: RuntimeParsedParams<"conversations.list">,
): Promise<Page<Conversation>> {
  const raw = SearchResponse.parse(
    await ctx.hl.request({
      method: "GET",
      path: "/conversations/search",
      version: HL_VERSION.conversations,
      query: {
        locationId: ctx.locationId,
        limit: p.limit,
        sort: "desc",
        sortBy: "last_message_date",
        query: p.query,
        contactId: p.contactId,
        startAfterDate: p.cursor
          ? decodeCursor("conversations", p.cursor).sad
          : undefined,
      },
      ...call(ctx),
    }),
  );
  const last = raw.conversations.at(-1);
  const sad = last
    ? (last.sort?.[0] ??
      (typeof last.lastMessageDate === "number"
        ? last.lastMessageDate
        : undefined))
    : undefined;
  const nextCursor =
    last && sad !== undefined && raw.conversations.length === p.limit
      ? encodeCursor({ k: "conversations", sad })
      : null;
  return {
    items: raw.conversations.map((r) => ({
      id: r.id,
      contactId: str(r.contactId),
      contactName: nullIfBlank(r.contactName) ?? nullIfBlank(r.fullName),
      lastMessageBody: nullIfBlank(r.lastMessageBody),
      lastMessageType: messageTypeLabel(r.lastMessageType),
      lastMessageDate: toIso(r.lastMessageDate ?? r.dateUpdated),
      unreadCount: typeof r.unreadCount === "number" ? r.unreadCount : 0,
    })),
    nextCursor,
    hasMore: nextCursor !== null,
  };
}

export async function listMessages(
  ctx: HlCallContext,
  p: RuntimeParsedParams<"conversations.messages">,
): Promise<Page<Message>> {
  const parsed = MessagesResponse.parse(
    await ctx.hl.request({
      method: "GET",
      path: `/conversations/${encodeURIComponent(p.conversationId)}/messages`,
      version: HL_VERSION.conversations,
      query: {
        limit: p.limit,
        lastMessageId: p.cursor
          ? decodeCursor("messages", p.cursor).lmi
          : undefined,
      },
      ...call(ctx),
    }),
  );
  // Flat shape: `messages` is the array itself. Nested shape: `messages` is the page object.
  type MessagesPageT = z.infer<typeof MessagesPage>;
  const page: MessagesPageT = Array.isArray(parsed.messages)
    ? (parsed as MessagesPageT)
    : (parsed.messages as MessagesPageT);
  const nextCursor =
    page.nextPage && page.lastMessageId
      ? encodeCursor({ k: "messages", lmi: page.lastMessageId })
      : null;
  return {
    items: page.messages.map((m) => ({
      id: m.id,
      conversationId: str(m.conversationId) ?? p.conversationId,
      body: nullIfBlank(m.body),
      direction: m.direction === "outbound" ? "outbound" : "inbound",
      type: messageTypeLabel(m.messageType ?? m.type),
      status: nullIfBlank(m.status),
      dateAdded: toIso(m.dateAdded),
    })),
    nextCursor,
    hasMore: nextCursor !== null,
  };
}
```

- [ ] **Step 6: Implement `calendars.adapter.ts`**

```ts
import { z } from "zod";
import { LIMITS } from "../../../contracts/limits.js";
import type {
  Calendar,
  CalendarEvent,
  ItemsResult,
  RuntimeParsedParams,
} from "../../../contracts/hl-runtime.js";
import { mapWithConcurrency } from "../../../shared/async.js";
import { HL_VERSION } from "../client/hl-http.client.js";
import { call, type HlCallContext } from "./context.js";
import { nullIfBlank, str, toIso } from "./normalize.js";

const RawCalendar = z
  .object({
    id: z.string(),
    name: z.unknown().optional(),
    description: z.unknown().optional(),
    isActive: z.unknown().optional(),
  })
  .passthrough();
const CalendarsResponse = z
  .object({ calendars: z.array(RawCalendar).default([]) })
  .passthrough();
const RawEvent = z
  .object({
    id: z.string(),
    calendarId: z.unknown().optional(),
    title: z.unknown().optional(),
    appointmentStatus: z.unknown().optional(),
    status: z.unknown().optional(),
    contactId: z.unknown().optional(),
    startTime: z.unknown(),
    endTime: z.unknown(),
  })
  .passthrough();
const EventsResponse = z
  .object({ events: z.array(RawEvent).default([]) })
  .passthrough();

export async function listCalendars(
  ctx: HlCallContext,
): Promise<ItemsResult<Calendar>> {
  const raw = CalendarsResponse.parse(
    await ctx.hl.request({
      method: "GET",
      path: "/calendars/",
      version: HL_VERSION.calendars,
      query: { locationId: ctx.locationId },
      ...call(ctx),
    }),
  );
  return {
    items: raw.calendars.map((c) => ({
      id: c.id,
      name: nullIfBlank(c.name) ?? "Untitled calendar",
      description: nullIfBlank(c.description),
      isActive: c.isActive !== false,
    })),
  };
}

export async function listEvents(
  ctx: HlCallContext,
  p: RuntimeParsedParams<"calendars.events">,
): Promise<ItemsResult<CalendarEvent>> {
  const startTime = String(Date.parse(p.from));
  const endTime = String(Date.parse(p.to));
  const calendarIds = p.calendarId
    ? [p.calendarId]
    : (await listCalendars(ctx)).items
        .filter((c) => c.isActive)
        .slice(0, LIMITS.calendarFanOutMax)
        .map((c) => c.id);

  const pages = await mapWithConcurrency(calendarIds, 3, async (calendarId) =>
    EventsResponse.parse(
      await ctx.hl.request({
        method: "GET",
        path: "/calendars/events",
        version: HL_VERSION.calendars,
        query: { locationId: ctx.locationId, calendarId, startTime, endTime },
        ...call(ctx),
      }),
    ).events.map((e) => ({ e, calendarId })),
  );

  const byId = new Map<string, CalendarEvent>();
  for (const { e, calendarId } of pages.flat()) {
    const start = toIso(e.startTime);
    const end = toIso(e.endTime);
    if (!start || !end || byId.has(e.id)) continue;
    byId.set(e.id, {
      id: e.id,
      calendarId: str(e.calendarId) ?? calendarId,
      title: nullIfBlank(e.title),
      status: nullIfBlank(e.appointmentStatus) ?? nullIfBlank(e.status),
      contactId: str(e.contactId),
      startTime: start,
      endTime: end,
    });
  }
  return {
    items: [...byId.values()].sort((a, b) =>
      a.startTime.localeCompare(b.startTime),
    ),
  };
}
```

- [ ] **Step 7: Implement `locations.adapter.ts`**

```ts
import type { Location } from "../../../contracts/hl-runtime.js";
import type { HlCallContext } from "./context.js";

/** Served from the connection projection (fetched at connect time) — no HighLevel call per request. */
export async function getLocation(ctx: HlCallContext): Promise<Location> {
  const p = await ctx.loadProjection();
  return {
    id: ctx.locationId,
    name: p?.locationName ?? ctx.locationId,
    timezone: p?.timezone ?? null,
  };
}
```

- [ ] **Step 8: Run tests → PASS. Step 9: Commit** — `feat(functions): add read-only HighLevel adapters with normalized models and cursors`.

---

### Task BE-4.4: Project access and runtime service

**Files:**

- Create: `functions/src/modules/projects/project-access.ts`, `functions/src/modules/highlevel/runtime/runtime.service.ts`
- Test: `functions/test/unit/highlevel/runtime.service.test.ts`

**Interfaces:**

- Produces: `interface ProjectRecord { id; name; status; locationId; activeGeneration: { id: string; heartbeatAtMs: number } | null; workingTreeDirty; latestSnapshotId; snapshotSeq; fileCount; totalBytes }`, `toProjectRecord(id, data)`, `isLeaseStale(active, nowMs)`, `interface ProjectAccessPort { getOwnedActive(uid, projectId); bindLocation(uid, projectId, locationId) }`, `class FirestoreProjectAccess`; `RUNTIME_HANDLERS`, `class RuntimeService { invoke(uid, projectId, method, rawParams, log) }`.

- [ ] **Step 1: Implement `project-access.ts`**

```ts
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { LIMITS } from "../../contracts/limits.js";
import { AppError } from "../../shared/app-error.js";
import { paths } from "../../shared/firestore-paths.js";

const Ts = z.custom<Timestamp>((v) => v instanceof Timestamp);
const ProjectSchema = z
  .object({
    name: z.string(),
    status: z.enum(["active", "deleted"]),
    locationId: z.string().nullable().optional(),
    activeGeneration: z
      .object({ id: z.string(), startedAt: Ts, heartbeatAt: Ts })
      .nullable()
      .optional(),
    workingTreeDirty: z.boolean().optional(),
    latestSnapshotId: z.string().nullable().optional(),
    snapshotSeq: z.number().int().optional(),
    fileCount: z.number().int().optional(),
    totalBytes: z.number().int().optional(),
  })
  .passthrough();

export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly status: "active" | "deleted";
  readonly locationId: string | null;
  readonly activeGeneration: { id: string; heartbeatAtMs: number } | null;
  readonly workingTreeDirty: boolean;
  readonly latestSnapshotId: string | null;
  readonly snapshotSeq: number;
  readonly fileCount: number;
  readonly totalBytes: number;
}

export function toProjectRecord(id: string, data: unknown): ProjectRecord {
  const d = ProjectSchema.parse(data);
  return {
    id,
    name: d.name,
    status: d.status,
    locationId: d.locationId ?? null,
    activeGeneration: d.activeGeneration
      ? {
          id: d.activeGeneration.id,
          heartbeatAtMs: d.activeGeneration.heartbeatAt.toMillis(),
        }
      : null,
    workingTreeDirty: d.workingTreeDirty ?? false,
    latestSnapshotId: d.latestSnapshotId ?? null,
    snapshotSeq: d.snapshotSeq ?? 0,
    fileCount: d.fileCount ?? 0,
    totalBytes: d.totalBytes ?? 0,
  };
}

export const isLeaseStale = (
  active: { heartbeatAtMs: number } | null,
  nowMs: number,
): boolean =>
  active !== null && nowMs - active.heartbeatAtMs > LIMITS.staleLeaseMs;

export interface ProjectAccessPort {
  getOwnedActive(uid: string, projectId: string): Promise<ProjectRecord>;
  bindLocation(
    uid: string,
    projectId: string,
    locationId: string,
  ): Promise<void>;
}

export class FirestoreProjectAccess implements ProjectAccessPort {
  constructor(private readonly db: Firestore) {}

  async getOwnedActive(uid: string, projectId: string): Promise<ProjectRecord> {
    const snap = await this.db.doc(paths.project(uid, projectId)).get();
    if (!snap.exists) throw new AppError("PROJECT_NOT_FOUND");
    const p = toProjectRecord(snap.id, snap.data());
    if (p.status !== "active") throw new AppError("PROJECT_NOT_FOUND");
    return p;
  }

  async bindLocation(
    uid: string,
    projectId: string,
    locationId: string,
  ): Promise<void> {
    const ref = this.db.doc(paths.project(uid, projectId));
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && (snap.get("locationId") ?? null) === null)
        tx.update(ref, { locationId });
    });
  }
}
```

- [ ] **Step 2: Write the failing runtime service tests**

```ts
import { RuntimeService } from "../../../src/modules/highlevel/runtime/runtime.service.js";
import { HlApiError } from "../../../src/modules/highlevel/client/hl-errors.js";
import { MemoryRateLimiter } from "../../../src/modules/rate-limit/rate-limiter.js";
import { AppError } from "../../../src/shared/app-error.js";
import { createFakeClock } from "../../../src/shared/clock.js";
import { fakeLogger, InMemoryConnectionRepo } from "../../helpers/fakes.js";
import type {
  ProjectAccessPort,
  ProjectRecord,
} from "../../../src/modules/projects/project-access.js";
import type { AccessGrant } from "../../../src/modules/highlevel/connection/token-manager.js";

const project = (over: Partial<ProjectRecord> = {}): ProjectRecord => ({
  id: "p1",
  name: "P",
  status: "active",
  locationId: "loc_1",
  activeGeneration: null,
  workingTreeDirty: false,
  latestSnapshotId: null,
  snapshotSeq: 0,
  fileCount: 0,
  totalBytes: 0,
  ...over,
});

function setup(
  opts: {
    project?: ProjectRecord;
    handler?: (token: string) => Promise<unknown>;
    scopes?: string[];
  } = {},
) {
  const bound: string[] = [];
  const projects: ProjectAccessPort = {
    getOwnedActive: () => Promise.resolve(opts.project ?? project()),
    bindLocation: (_u, _p, loc) => {
      bound.push(loc);
      return Promise.resolve();
    },
  };
  let n = 0;
  const grant = (token: string): AccessGrant => ({
    accessToken: token,
    locationId: "loc_1",
    expiresAtMs: 1_000,
    scopes: opts.scopes ?? [],
  });
  const tokens = {
    getAccessGrant: vi.fn(() => Promise.resolve(grant("t0"))),
    forceRefresh: vi.fn(() => {
      n += 1;
      return Promise.resolve(grant(`t${n}`));
    }),
    markReauth: vi.fn(() =>
      Promise.resolve(new AppError("HL_REAUTH_REQUIRED")),
    ),
  };
  const handler = vi.fn((ctx: { accessToken: string }, _params: unknown) =>
    (opts.handler ?? (() => Promise.resolve({ ok: ctx.accessToken })))(
      ctx.accessToken,
    ),
  );
  const service = new RuntimeService({
    projects,
    tokens,
    connections: new InMemoryConnectionRepo(),
    hl: { request: () => Promise.resolve(null) },
    limiter: new MemoryRateLimiter(createFakeClock(0)),
    handlers: { "contacts.list": handler, "contacts.create": handler } as never,
  });
  return { service, tokens, handler, bound };
}

describe("RuntimeService", () => {
  it("invokes the handler with validated params", async () => {
    const s = setup();
    await expect(
      s.service.invoke(
        "u",
        "p1",
        "contacts.list",
        { limit: "5" },
        fakeLogger(),
      ),
    ).resolves.toEqual({ ok: "t0" });
    expect(s.handler.mock.calls[0]![1]).toEqual({ limit: 5 });
  });
  it("rejects invalid params", async () => {
    await expect(
      setup().service.invoke(
        "u",
        "p1",
        "contacts.list",
        { limit: 999 },
        fakeLogger(),
      ),
    ).rejects.toThrow();
  });
  it("refuses a project bound to another location, binds when unbound", async () => {
    await expect(
      setup({ project: project({ locationId: "other" }) }).service.invoke(
        "u",
        "p1",
        "contacts.list",
        {},
        fakeLogger(),
      ),
    ).rejects.toMatchObject({ code: "PROJECT_LOCATION_MISMATCH" });
    const s = setup({ project: project({ locationId: null }) });
    await s.service.invoke("u", "p1", "contacts.list", {}, fakeLogger());
    expect(s.bound).toEqual(["loc_1"]);
  });
  it("refreshes once on 401 and retries", async () => {
    let calls = 0;
    const s = setup({
      handler: (token) => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new HlApiError(401, "expired", null, null))
          : Promise.resolve({ token });
      },
    });
    await expect(
      s.service.invoke("u", "p1", "contacts.list", {}, fakeLogger()),
    ).resolves.toEqual({ token: "t1" });
    expect(s.tokens.forceRefresh).toHaveBeenCalledTimes(1);
  });
  it("marks reauth after a second 401", async () => {
    const s = setup({
      handler: () => Promise.reject(new HlApiError(401, "expired", null, null)),
    });
    await expect(
      s.service.invoke("u", "p1", "contacts.list", {}, fakeLogger()),
    ).rejects.toMatchObject({ code: "HL_REAUTH_REQUIRED" });
    expect(s.tokens.markReauth).toHaveBeenCalled();
  });
  it("maps other HighLevel errors", async () => {
    const s = setup({
      handler: () =>
        Promise.reject(new HlApiError(429, "slow down", null, 1_000)),
    });
    await expect(
      s.service.invoke("u", "p1", "contacts.list", {}, fakeLogger()),
    ).rejects.toMatchObject({ code: "HL_RATE_LIMITED" });
  });
  it("checks granted scopes when known", async () => {
    const s = setup({ scopes: ["contacts.readonly"] });
    await expect(
      s.service.invoke(
        "u",
        "p1",
        "contacts.create",
        { firstName: "A" },
        fakeLogger(),
      ),
    ).rejects.toMatchObject({ code: "HL_SCOPE_MISSING" });
  });
});
```

- [ ] **Step 3: Implement `runtime.service.ts`**

```ts
import {
  RUNTIME_METHODS,
  type RuntimeMethodName,
  type RuntimeParsedParams,
} from "../../../contracts/hl-runtime.js";
import { AppError } from "../../../shared/app-error.js";
import type { Logger } from "../../../shared/logger.js";
import { serializeError } from "../../../shared/logger.js";
import type { ProjectAccessPort } from "../../projects/project-access.js";
import { getLocation } from "../adapters/locations.adapter.js";
import { getContact, listContacts } from "../adapters/contacts.adapter.js";
import {
  listConversations,
  listMessages,
} from "../adapters/conversations.adapter.js";
import { listCalendars, listEvents } from "../adapters/calendars.adapter.js";
import type { HlCallContext } from "../adapters/context.js";
import { HlApiError, hlErrorToAppError } from "../client/hl-errors.js";
import type { HlHttp } from "../client/hl-http.client.js";
import type { ConnectionRepo } from "../connection/connection.repo.js";
import type { AccessGrant, TokenManager } from "../connection/token-manager.js";

export type RuntimeHandler = (
  ctx: HlCallContext,
  params: unknown,
) => Promise<unknown>;

export const RUNTIME_HANDLERS: Record<RuntimeMethodName, RuntimeHandler> = {
  "location.get": (ctx) => getLocation(ctx),
  "contacts.list": (ctx, p) =>
    listContacts(ctx, p as RuntimeParsedParams<"contacts.list">),
  "contacts.get": (ctx, p) =>
    getContact(ctx, p as RuntimeParsedParams<"contacts.get">),
  "conversations.list": (ctx, p) =>
    listConversations(ctx, p as RuntimeParsedParams<"conversations.list">),
  "conversations.messages": (ctx, p) =>
    listMessages(ctx, p as RuntimeParsedParams<"conversations.messages">),
  "calendars.list": (ctx) => listCalendars(ctx),
  "calendars.events": (ctx, p) =>
    listEvents(ctx, p as RuntimeParsedParams<"calendars.events">),
};

type TokenPort = Pick<
  TokenManager,
  "getAccessGrant" | "forceRefresh" | "markReauth"
>;

export interface RuntimeServiceDeps {
  projects: ProjectAccessPort;
  tokens: TokenPort;
  connections: ConnectionRepo;
  hl: HlHttp;
  handlers?: Partial<Record<RuntimeMethodName, RuntimeHandler>>;
}

export class RuntimeService {
  private readonly handlers: Record<RuntimeMethodName, RuntimeHandler>;

  constructor(private readonly d: RuntimeServiceDeps) {
    this.handlers = { ...RUNTIME_HANDLERS, ...d.handlers };
  }

  async invoke(
    uid: string,
    projectId: string,
    method: RuntimeMethodName,
    rawParams: unknown,
    log: Logger,
  ): Promise<unknown> {
    const spec = RUNTIME_METHODS[method];
    const params: unknown = spec.params.parse(rawParams);
    await this.consume(RATE_LIMITS.hlProxy, uid);
    if (spec.write) await this.consume(RATE_LIMITS.hlProxyWrite, uid);

    const project = await this.d.projects.getOwnedActive(uid, projectId);
    let grant = await this.d.tokens.getAccessGrant(uid);
    if (
      grant.scopes.length > 0 &&
      !spec.scopes.every((s) => grant.scopes.includes(s))
    )
      throw new AppError("HL_SCOPE_MISSING");
    if (project.locationId && project.locationId !== grant.locationId)
      throw new AppError("PROJECT_LOCATION_MISMATCH");
    if (!project.locationId) {
      await this.d.projects
        .bindLocation(uid, projectId, grant.locationId)
        .catch((err: unknown) => {
          log.warn("project.bind_location_failed", {
            error: serializeError(err),
          });
        });
    }

    const handler = this.handlers[method];
    const ctxFor = (g: AccessGrant): HlCallContext => ({
      hl: this.d.hl,
      accessToken: g.accessToken,
      locationId: g.locationId,
      loadProjection: () => this.d.connections.getProjection(uid),
    });

    try {
      return await handler(ctxFor(grant), params);
    } catch (err) {
      if (!(err instanceof HlApiError)) throw err;
      if (err.status !== 401) throw hlErrorToAppError(err);
      grant = await this.d.tokens.forceRefresh(uid, grant.expiresAtMs);
      try {
        return await handler(ctxFor(grant), params);
      } catch (err2) {
        if (err2 instanceof HlApiError && err2.status === 401)
          throw await this.d.tokens.markReauth(uid, "hl_401_after_refresh");
        throw err2 instanceof HlApiError ? hlErrorToAppError(err2) : err2;
      }
    } finally {
      if (spec.write) log.info("hl.write", { method, projectId });
    }
  }

  private async consume(rule: RateLimitRule, uid: string): Promise<void> {
    const r = await this.d.limiter.consume(rule, uid);
    if (!r.allowed)
      throw new AppError("RATE_LIMITED", undefined, {
        retryAfterMs: r.retryAfterMs,
      });
  }
}
```

- [ ] **Step 4: Run tests → PASS. Step 5: Commit** — `feat(functions): add project access and allow-listed runtime service`.

---

### Task BE-4.5: Manifest-driven runtime routes

**Files:**

- Create: `functions/src/modules/highlevel/runtime/runtime.routes.ts`
- Modify: `functions/src/composition.ts`
- Test: `functions/test/unit/highlevel/runtime.routes.test.ts`

**Interfaces:**

- Produces: `runtimeRouter(service: Pick<RuntimeService, 'invoke'>): Router` registering one route per manifest entry at `/v1/projects/:projectId` + `spec.path`.

- [ ] **Step 1: Test**

```ts
import request from "supertest";
import { createHttpApp } from "../../../src/http/create-http-app.js";
import { runtimeRouter } from "../../../src/modules/highlevel/runtime/runtime.routes.js";
import { fakeLogger } from "../../helpers/fakes.js";

const makeInvoke = () =>
  vi.fn(
    (
      _uid: string,
      _projectId: string,
      _method: string,
      _raw: unknown,
      _log: unknown,
    ) => Promise.resolve<unknown>({ ok: true }),
  );

function app(invoke = makeInvoke()) {
  return {
    invoke,
    app: createHttpApp({
      service: "api",
      version: "t",
      allowedOrigins: [],
      logger: fakeLogger(),
      verifyIdToken: () => Promise.resolve({ uid: "u1" }),
      authedRouters: [runtimeRouter({ invoke })],
    }),
  };
}

describe("runtime routes", () => {
  it("merges path params and query for GET", async () => {
    const t = app();
    const res = await request(t.app)
      .get("/v1/projects/p1/hl/conversations/v9/messages?limit=5")
      .set("Authorization", "Bearer x");
    expect(res.body).toEqual({ data: { ok: true } });
    expect(t.invoke).toHaveBeenCalledWith(
      "u1",
      "p1",
      "conversations.messages",
      { limit: "5", conversationId: "v9" },
      expect.anything(),
    );
  });
  it("uses the JSON body for POST/PATCH", async () => {
    const t = app();
    await request(t.app)
      .patch("/v1/projects/p1/hl/contacts/c1")
      .set("Authorization", "Bearer x")
      .send({ firstName: "A" });
    expect(t.invoke).toHaveBeenCalledWith(
      "u1",
      "p1",
      "contacts.update",
      { firstName: "A", contactId: "c1" },
      expect.anything(),
    );
  });
  it("distinguishes /calendars/events from /calendars/:id/free-slots", async () => {
    const t = app();
    await request(t.app)
      .get("/v1/projects/p1/hl/calendars/events?from=a&to=b")
      .set("Authorization", "Bearer x");
    await request(t.app)
      .get("/v1/projects/p1/hl/calendars/k1/free-slots?from=a&to=b")
      .set("Authorization", "Bearer x");
    expect(t.invoke.mock.calls.map((c) => c[2])).toEqual([
      "calendars.events",
      "calendars.freeSlots",
    ]);
  });
});
```

- [ ] **Step 2: Implement**

```ts
import express, { type RequestHandler, type Router } from "express";
import { z } from "zod";
import { DocId } from "../../../contracts/api.js";
import {
  RUNTIME_METHOD_NAMES,
  RUNTIME_METHODS,
} from "../../../contracts/hl-runtime.js";
import { requireUid } from "../../../http/define-handler.js";
import { sendData } from "../../../http/respond.js";
import type { RuntimeService } from "./runtime.service.js";

const PathParams = z.object({ projectId: DocId }).catchall(z.string());
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function runtimeRouter(service: Pick<RuntimeService, "invoke">): Router {
  const r = express.Router();
  for (const method of RUNTIME_METHOD_NAMES) {
    const spec = RUNTIME_METHODS[method];
    const route = `/v1/projects/:projectId${spec.path}`;
    const handler: RequestHandler = async (req, res) => {
      const { projectId, ...pathParams } = PathParams.parse(req.params);
      const source: unknown = spec.verb === "GET" ? req.query : req.body;
      const raw = { ...(isPlainObject(source) ? source : {}), ...pathParams };
      sendData(
        res,
        await service.invoke(
          requireUid(req),
          projectId,
          method,
          raw,
          req.ctx.log,
        ),
      );
    };
    if (spec.verb === "GET") r.get(route, handler);
    else if (spec.verb === "POST") r.post(route, handler);
    else r.patch(route, handler);
  }
  return r;
}
```

- [ ] **Step 3: Wire in `composition.ts` (api)**

```ts
const hl = createHlHttpClient({
  baseUrl: config.hlApiBaseUrl,
  limiter: new LocationRateLimiter(clock),
  logger: logger.child({ component: "hl" }),
});
const tokenManager = new TokenManager({
  repo: connections,
  tokens: tokenEndpoint,
  cipher,
  clock,
  logger,
});
const projectAccess = new FirestoreProjectAccess(db);
const runtime = new RuntimeService({
  projects: projectAccess,
  tokens: tokenManager,
  connections,
  hl,
  limiter: new MemoryRateLimiter(clock),
});
authedRouters.push(runtimeRouter(runtime));
```

- [ ] **Step 4: Manual sandbox check** (emulators + PIT-seeded connection from BE-3.8 + a project doc created in the Emulator UI or via FE-2):

```bash
TOKEN=$(node -e "…")   # simplest: copy an ID token from the browser devtools (auth.currentUser.getIdToken())
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:5001/genesis-builder-7f3a/us-central1/api/v1/projects/<pid>/hl/contacts?limit=20" | jq '.data.items | length, .data.hasMore'
```

Expected: `20` and `true` with ≥ 30 seeded contacts. Repeat with `&cursor=<nextCursor>` → the remaining contacts, `hasMore: false`.

- [ ] **Step 5: Commit** — `feat(functions): expose manifest-driven HighLevel runtime routes`.

---

### Task BE-4.6: Location context service (bounded external context for prompts)

**Files:**

- Create: `functions/src/modules/highlevel/metadata/location-context.service.ts`
- Test: `functions/test/unit/highlevel/location-context.test.ts`

**Interfaces:**

- Produces: `interface HighLevelContext { status: 'connected' | 'reauth_required' | 'disconnected'; locationName: string | null; timezone: string | null; calendars: string[]; contactsTotal: number | null; availableMethods: RuntimeMethodName[]; note: string | null }`; `interface LocationContextPort { getContext(uid): Promise<HighLevelContext> }`; `class LocationContextService`.

- [ ] **Step 1: Test**

```ts
import { LocationContextService } from "../../../src/modules/highlevel/metadata/location-context.service.js";
import { createFakeClock } from "../../../src/shared/clock.js";
import { fakeLogger, InMemoryConnectionRepo } from "../../helpers/fakes.js";

function setup(
  route: (path: string) => unknown,
  status: "connected" | "reauth_required" = "connected",
) {
  const connections = new InMemoryConnectionRepo();
  connections.projections.set("u", {
    status,
    locationId: "loc",
    locationName: "Demo Clinic",
    timezone: "America/New_York",
    scopes: [],
  });
  const request = vi.fn((req: { path: string }) =>
    Promise.resolve(route(req.path)),
  );
  const svc = new LocationContextService({
    connections,
    tokens: {
      getAccessGrant: () =>
        Promise.resolve({
          accessToken: "t",
          locationId: "loc",
          expiresAtMs: 0,
          scopes: ["calendars.readonly", "contacts.readonly"],
        }),
    },
    hl: { request },
    clock: createFakeClock(0),
    logger: fakeLogger(),
  });
  return { svc, request };
}

describe("LocationContextService", () => {
  it("returns metadata only (names, counts, methods)", async () => {
    const { svc } = setup((p) =>
      p === "/calendars/"
        ? { calendars: [{ id: "k1", name: "Consultations" }] }
        : { contacts: [], total: 36 },
    );
    const ctx = await svc.getContext("u");
    expect(ctx).toMatchObject({
      status: "connected",
      locationName: "Demo Clinic",
      calendars: ["Consultations"],
      contactsTotal: 36,
      note: null,
    });
    expect(ctx.availableMethods).toEqual(
      expect.arrayContaining([
        "contacts.list",
        "calendars.list",
        "calendars.freeSlots",
      ]),
    );
    expect(ctx.availableMethods).not.toContain("contacts.create");
  });
  it("caches per location", async () => {
    const { svc, request } = setup(() => ({
      calendars: [],
      contacts: [],
      total: 0,
    }));
    await svc.getContext("u");
    await svc.getContext("u");
    expect(request).toHaveBeenCalledTimes(2); // calendars + count, once
  });
  it("degrades gracefully", async () => {
    const { svc } = setup(() => {
      throw new Error("down");
    });
    expect((await svc.getContext("u")).note).toMatch(/unavailable/);
  });
  it("reports not connected", async () => {
    const { svc } = setup(() => ({}), "reauth_required");
    expect((await svc.getContext("u")).status).toBe("reauth_required");
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { LIMITS } from "../../../contracts/limits.js";
import {
  RUNTIME_METHOD_NAMES,
  RUNTIME_METHODS,
  type RuntimeMethodName,
} from "../../../contracts/hl-runtime.js";
import { withTimeout } from "../../../shared/async.js";
import type { Clock } from "../../../shared/clock.js";
import { serializeError, type Logger } from "../../../shared/logger.js";
import { countContacts } from "../adapters/contacts.adapter.js";
import { listCalendars } from "../adapters/calendars.adapter.js";
import type { HlHttp } from "../client/hl-http.client.js";
import type {
  ConnectionProjection,
  ConnectionRepo,
} from "../connection/connection.repo.js";
import type { TokenManager } from "../connection/token-manager.js";

export interface HighLevelContext {
  status: "connected" | "reauth_required" | "disconnected";
  locationName: string | null;
  timezone: string | null;
  calendars: string[];
  contactsTotal: number | null;
  availableMethods: RuntimeMethodName[];
  note: string | null;
}

export interface LocationContextPort {
  getContext(uid: string): Promise<HighLevelContext>;
}

export interface LocationContextDeps {
  connections: Pick<ConnectionRepo, "getProjection">;
  tokens: Pick<TokenManager, "getAccessGrant">;
  hl: HlHttp;
  clock: Clock;
  logger: Logger;
  ttlMs?: number;
  timeoutMs?: number;
}

export class LocationContextService implements LocationContextPort {
  private readonly cache = new Map<
    string,
    { at: number; value: HighLevelContext }
  >();

  constructor(private readonly d: LocationContextDeps) {}

  async getContext(uid: string): Promise<HighLevelContext> {
    const p = await this.d.connections.getProjection(uid);
    if (!p || p.status !== "connected" || !p.locationId) {
      return {
        status: p?.status ?? "disconnected",
        locationName: null,
        timezone: null,
        calendars: [],
        contactsTotal: null,
        availableMethods: [],
        note: "HighLevel is not connected yet.",
      };
    }
    const cached = this.cache.get(p.locationId);
    if (cached && this.d.clock.now() - cached.at < (this.d.ttlMs ?? 300_000))
      return cached.value;

    let value: HighLevelContext;
    try {
      value = await withTimeout(
        this.fetch(uid, p),
        this.d.timeoutMs ?? 2_500,
        () => new Error("timeout"),
      );
    } catch (err) {
      this.d.logger.warn("hl.context.unavailable", {
        error: serializeError(err),
      });
      value = {
        status: "connected",
        locationName: p.locationName,
        timezone: p.timezone,
        calendars: [],
        contactsTotal: null,
        availableMethods: [...RUNTIME_METHOD_NAMES],
        note: "HighLevel metadata unavailable right now.",
      };
    }
    this.cache.set(p.locationId, { at: this.d.clock.now(), value });
    return value;
  }

  private async fetch(
    uid: string,
    p: ConnectionProjection,
  ): Promise<HighLevelContext> {
    const grant = await this.d.tokens.getAccessGrant(uid);
    const ctx = {
      hl: this.d.hl,
      accessToken: grant.accessToken,
      locationId: grant.locationId,
      loadProjection: () => Promise.resolve(p),
    };
    const [calendars, total] = await Promise.all([
      listCalendars(ctx),
      countContacts(ctx),
    ]);
    const granted = grant.scopes;
    return {
      status: "connected",
      locationName: p.locationName,
      timezone: p.timezone,
      calendars: calendars.items
        .slice(0, LIMITS.externalCalendarsMax)
        .map((c) => c.name),
      contactsTotal: total,
      availableMethods: RUNTIME_METHOD_NAMES.filter(
        (m) =>
          granted.length === 0 ||
          RUNTIME_METHODS[m].scopes.every((s) => granted.includes(s)),
      ),
      note: null,
    };
  }
}
```

- [ ] **Step 3: Run tests → PASS. Step 4: Commit** — `feat(functions): add bounded HighLevel metadata context for prompts`.

---

### Task BE-4.7: Fixture recorder (scrubbed sandbox responses)

**Files:**

- Create: `functions/scripts/record-hl-fixtures.ts`
- Output: `functions/test/fixtures/hl/*.json` (scrubbed, committed), `functions/test/fixtures/hl/raw/*.json` (git-ignored)

- [ ] **Step 1: Implement**

```ts
// Usage: after `npm run spike:oauth` created spike-tokens.json → `npm run record:fixtures`
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const { access_token: token, locationId } = JSON.parse(
  readFileSync("spike-tokens.json", "utf8"),
) as { access_token: string; locationId: string };
const BASE = "https://services.leadconnectorhq.com";

async function hl(
  path: string,
  version: string,
  init: { method?: string; body?: unknown } = {},
) {
  const res = await fetch(BASE + path, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: version,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as unknown,
  };
}

const PII_KEYS: Record<string, string> = {
  email: "person@example.com",
  phone: "+15550000000",
  firstName: "Test",
  lastName: "Person",
  contactName: "Test Person",
  fullName: "Test Person",
  name: "Test Name",
  body: "Sample message body",
  lastMessageBody: "Sample message body",
  address1: "Redacted",
  city: "Redacted",
  postalCode: "00000",
  companyName: "Example Co",
  title: "Sample appointment",
};
function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, val]) => [
        k,
        k in PII_KEYS && typeof val === "string" ? PII_KEYS[k] : scrub(val),
      ]),
    );
  }
  return v;
}

const now = Date.now();
const week = 7 * 24 * 3_600_000;
const out: Record<string, { status: number; body: unknown }> = {};
out["contacts-search-p1"] = await hl("/contacts/search", "2021-07-28", {
  method: "POST",
  body: {
    locationId,
    pageLimit: 20,
    sort: [{ field: "dateAdded", direction: "desc" }],
  },
});
const p1 = out["contacts-search-p1"].body as {
  contacts?: { searchAfter?: unknown[]; id: string }[];
};
const last = p1.contacts?.at(-1);
if (last?.searchAfter)
  out["contacts-search-p2"] = await hl("/contacts/search", "2021-07-28", {
    method: "POST",
    body: { locationId, pageLimit: 20, searchAfter: last.searchAfter },
  });
if (last) out["contact-get"] = await hl(`/contacts/${last.id}`, "2021-07-28");
out["conversations-search"] = await hl(
  `/conversations/search?locationId=${locationId}&limit=5&sort=desc&sortBy=last_message_date`,
  "2021-04-15",
);
const conv = (
  out["conversations-search"].body as { conversations?: { id: string }[] }
).conversations?.[0];
if (conv)
  out["conversation-messages"] = await hl(
    `/conversations/${conv.id}/messages?limit=5`,
    "2021-04-15",
  );
out["calendars"] = await hl(
  `/calendars/?locationId=${locationId}`,
  "2021-04-15",
);
const cal = (out["calendars"].body as { calendars?: { id: string }[] })
  .calendars?.[0];
if (cal) {
  out["calendar-events"] = await hl(
    `/calendars/events?locationId=${locationId}&calendarId=${cal.id}&startTime=${now}&endTime=${now + 2 * week}`,
    "2021-04-15",
  );
  out["calendar-free-slots"] = await hl(
    `/calendars/${cal.id}/free-slots?startDate=${now}&endDate=${now + week}`,
    "2021-04-15",
  );
}
out["location"] = await hl(`/locations/${locationId}`, "2021-07-28");

mkdirSync("test/fixtures/hl/raw", { recursive: true });
for (const [name, value] of Object.entries(out)) {
  writeFileSync(
    `test/fixtures/hl/raw/${name}.json`,
    JSON.stringify(value, null, 2),
  );
  writeFileSync(
    `test/fixtures/hl/${name}.json`,
    JSON.stringify(scrub(value), null, 2),
  );
  console.log(`${name}: HTTP ${value.status}`);
}
```

- [ ] **Step 2: Run** → review `test/fixtures/hl/*.json` by eye (no real names/emails/phones/tokens). Update adapters if shapes differ from assumptions (record findings in `research/02` §12). Add one regression test per fixture to `adapters.test.ts` that feeds the recorded body through the adapter and asserts it parses.

- [ ] **Step 3: Commit** — `test(functions): add scrubbed HighLevel sandbox fixtures and recorder`.
