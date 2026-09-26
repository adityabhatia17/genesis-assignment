# BE-1 — Shared contracts

> Read [`00-overview.md`](00-overview.md) first. Contracts are **pure**: they may import only `zod` and each other. No Node, Firebase or DOM APIs. Canonical meaning: [`../07-end-to-end-system-design.md`](../07-end-to-end-system-design.md) §3.

**Outcome:** `functions/src/contracts/` holds every cross-boundary schema and type; `scripts/sync-contracts.mjs` copies them to `frontend/src/contracts/`; CI fails on drift.

---

### Task BE-1.1: Limits and file-path rules

**Files:**
- Create: `functions/src/contracts/limits.ts`, `functions/src/contracts/paths.ts`
- Test: `functions/test/unit/contracts/paths.test.ts`

**Interfaces:**
- Produces: `LIMITS` (readonly numeric constants), `FILE_PATH_RE`, `ENTRY_FILE = 'index.html'`, `type FileLanguage = 'html' | 'css' | 'javascript'`, `FileLanguageSchema`, `languageForPath(path): FileLanguage | null`, `isValidFilePath(path): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
import { isValidFilePath, languageForPath } from '../../../src/contracts/paths.js';

describe('file path rules', () => {
  it.each(['index.html', 'styles.css', 'app.js', 'js/api.js', 'css/cards.css', 'a/b/c.js', 'lib/date-utils.min.js'])('accepts %s', (p) => {
    expect(isValidFilePath(p)).toBe(true);
  });
  it.each(['about.html', 'pages/index.html', 'App.js', '../x.js', '/app.js', 'a/b/c/d.js', 'x.ts', 'x', '.env', 'a b.js', 'js//a.js'])('rejects %s', (p) => {
    expect(isValidFilePath(p)).toBe(false);
  });
  it('derives language from the extension', () => {
    expect(languageForPath('index.html')).toBe('html');
    expect(languageForPath('x.css')).toBe('css');
    expect(languageForPath('x.js')).toBe('javascript');
    expect(languageForPath('x.ts')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- paths` → FAIL.

- [ ] **Step 3: Implement `limits.ts`**

```ts
export const LIMITS = {
  promptMaxChars: 4_000,
  maxFiles: 25,
  maxFileBytes: 102_400,
  maxProjectBytes: 307_200,
  maxPathSegments: 3,
  historyMessages: 12,
  historyMessageMaxChars: 4_000,
  projectNameMax: 60,
  projectDescriptionMax: 280,
  generationDeadlineMs: 300_000,
  heartbeatMs: 15_000,
  staleLeaseMs: 60_000,
  oauthStateTtlMs: 600_000,
  sseWatchdogMs: 45_000,
  maxOutputTokens: 32_000,
  rawArtifactMaxBytes: 900_000,
  pageLimitDefault: 20,
  pageLimitMax: 100,
  calendarRangeMaxDays: 31,
  calendarFanOutMax: 10,
  externalCalendarsMax: 20,
  bridgeMaxInFlight: 6,
  bridgeCallsPerMinute: 120,
  bridgeWritesPerMinute: 10,
  bridgeCallTimeoutMs: 20_000,
  bridgeMaxParamsBytes: 65_536,
} as const;
```

- [ ] **Step 4: Implement `paths.ts`**

```ts
import { z } from 'zod';

/** Up to two folders + file name; lowercase; html/css/js only. */
export const FILE_PATH_RE = /^(?:[a-z0-9_-]+\/){0,2}[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.(?:html|css|js)$/;
export const ENTRY_FILE = 'index.html';

export const FileLanguageSchema = z.enum(['html', 'css', 'javascript']);
export type FileLanguage = z.infer<typeof FileLanguageSchema>;

export function languageForPath(path: string): FileLanguage | null {
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.js')) return 'javascript';
  return null;
}

export function isValidFilePath(path: string): boolean {
  if (!FILE_PATH_RE.test(path)) return false;
  return !path.endsWith('.html') || path === ENTRY_FILE;
}
```

- [ ] **Step 5: Run tests** → PASS. **Step 6: Commit** — `git commit -am "feat(contracts): add limits and file path rules"` (add new files with `git add` first).

---

### Task BE-1.2: Firestore document contracts

**Files:**
- Create: `functions/src/contracts/firestore-docs.ts`
- Test: `functions/test/unit/contracts/firestore-docs.test.ts`

**Interfaces:**
- Produces: `IssueSchema`/`Issue`, `UsageSchema`/`Usage`, `PartialResultSchema`/`PartialResult`, `GenerationStatus`, `TERMINAL_GENERATION_STATUSES`, `SnapshotKind`, `FileSource`, `IntegrationStatus`, and document interfaces `IntegrationDoc<T>`, `ActiveGeneration<T>`, `ProjectDoc<T>`, `FileDoc<T>`, `MessageDoc<T>`, `MessageMeta`, `GenerationDoc<T>`, `StagedFileDoc<T>`, `RawArtifactDoc<T>`, `SnapshotFileEntry`, `SnapshotDoc<T>`, `BlobDoc<T>`. `T` is the timestamp type (`firebase-admin` `Timestamp` on the server, `firebase/firestore` `Timestamp` in the browser).

- [ ] **Step 1: Write the failing test**

```ts
import { IssueSchema, TERMINAL_GENERATION_STATUSES, UsageSchema } from '../../../src/contracts/firestore-docs.js';

describe('firestore doc contracts', () => {
  it('validates issues and usage', () => {
    expect(IssueSchema.parse({ code: 'JS_SYNTAX', message: 'Unexpected token', severity: 'error', path: 'app.js', line: 3, column: 7 })).toBeTruthy();
    expect(() => IssueSchema.parse({ code: 'X', message: 'y', severity: 'fatal' })).toThrow();
    expect(UsageSchema.parse({ inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUsd: 0.01 })).toBeTruthy();
  });
  it('lists terminal statuses', () => {
    expect(TERMINAL_GENERATION_STATUSES).toEqual(['completed', 'failed', 'interrupted']);
  });
});
```

- [ ] **Step 2: Implement `firestore-docs.ts`**

```ts
import { z } from 'zod';
import type { ErrorCode } from './errors.js';
import type { FileLanguage } from './paths.js';

export const IssueSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  severity: z.enum(['error', 'warning']),
  path: z.string().optional(),
  line: z.number().int().optional(),
  column: z.number().int().optional(),
});
export type Issue = z.infer<typeof IssueSchema>;

export const UsageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadInputTokens: z.number().int().min(0),
  cacheCreationInputTokens: z.number().int().min(0),
  costUsd: z.number().min(0),
});
export type Usage = z.infer<typeof UsageSchema>;

export const PartialResultSchema = z.object({
  stagedPaths: z.array(z.string()),
  applyable: z.boolean(),
});
export type PartialResult = z.infer<typeof PartialResultSchema>;

export const GENERATION_STATUSES = ['streaming', 'completed', 'failed', 'interrupted'] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];
export const TERMINAL_GENERATION_STATUSES = ['completed', 'failed', 'interrupted'] as const;
export type TerminalGenerationStatus = (typeof TERMINAL_GENERATION_STATUSES)[number];

export type SnapshotKind = 'generation' | 'checkpoint' | 'restore';
export type FileSource = 'ai' | 'manual' | 'restore';
export type IntegrationStatus = 'connected' | 'reauth_required' | 'disconnected';
export type ProjectStatus = 'active' | 'deleted';
export type MessageRole = 'user' | 'assistant' | 'system';

export interface IntegrationDoc<T> {
  provider: 'highlevel';
  status: IntegrationStatus;
  locationId: string | null;
  locationName: string | null;
  timezone: string | null;
  scopes: string[];
  connectedAt: T | null;
  updatedAt: T;
  lastErrorCode: string | null;
}

export interface ActiveGeneration<T> {
  id: string;
  startedAt: T;
  heartbeatAt: T;
}

export interface ProjectDoc<T> {
  name: string;
  description: string;
  locationId: string | null;
  status: ProjectStatus;
  createdAt: T;
  updatedAt: T;
  deletedAt: T | null;
  // server-owned (absent until the first server write)
  latestSnapshotId?: string | null;
  snapshotSeq?: number;
  fileCount?: number;
  totalBytes?: number;
  workingTreeDirty?: boolean;
  activeGeneration?: ActiveGeneration<T> | null;
  lastGenerationAt?: T | null;
}

export interface FileDoc<T> {
  path: string;
  language: FileLanguage;
  content: string;
  sizeBytes: number;
  contentHash: string;
  version: number;
  source: FileSource;
  updatedAt: T;
  lastGenerationId: string | null;
}

export interface MessageMeta {
  status?: GenerationStatus;
  changedPaths?: string[];
  deletedPaths?: string[];
  rejectedPaths?: string[];
  snapshotId?: string | null;
  snapshotSeq?: number | null;
}

export interface MessageDoc<T> {
  role: MessageRole;
  content: string;
  generationId: string | null;
  createdAt: T;
  meta: MessageMeta | null;
}

export interface GenerationError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export interface GenerationResult {
  snapshotId: string;
  snapshotSeq: number;
  changedPaths: string[];
  deletedPaths: string[];
  rejected: { path: string; issues: Issue[] }[];
  warnings: Issue[];
  noChanges: boolean;
}

export interface GenerationPartial<T> extends PartialResult {
  appliedAt: T | null;
  appliedSnapshotId: string | null;
  discardedAt: T | null;
}

export interface GenerationDoc<T> {
  status: GenerationStatus;
  prompt: string;
  promptVersion: string;
  model: string;
  effort: string;
  createdAt: T;
  startedAt: T;
  completedAt: T | null;
  heartbeatAt: T;
  stopReason: string | null;
  error: GenerationError | null;
  result: GenerationResult | null;
  partial: GenerationPartial<T> | null;
  usage: Usage | null;
  timings: { ttftMs: number | null; totalMs: number | null };
  context: { fileCount: number; historyMessages: number; externalIncluded: boolean; promptChars: number };
}

export interface StagedFileDoc<T> {
  path: string;
  op: 'write' | 'delete';
  content: string | null;
  sizeBytes: number;
  contentHash: string | null;
  issues: Issue[];
  createdAt: T;
}

export interface RawArtifactDoc<T> {
  text: string;
  truncated: boolean;
  sizeBytes: number;
  createdAt: T;
}

export interface SnapshotFileEntry {
  path: string;
  blobId: string;
  sizeBytes: number;
  language: FileLanguage;
}

export interface SnapshotDoc<T> {
  seq: number;
  kind: SnapshotKind;
  label: string;
  generationId: string | null;
  restoredFromSnapshotId: string | null;
  parentSnapshotId: string | null;
  files: Record<string, SnapshotFileEntry>;
  fileCount: number;
  totalBytes: number;
  changedPaths: string[];
  deletedPaths: string[];
  createdAt: T;
}

export interface BlobDoc<T> {
  content: string;
  sizeBytes: number;
  createdAt: T;
}

```

- [ ] **Step 3: Run tests** → PASS. **Step 4: Commit** — `feat(contracts): add Firestore document contracts`.

---

### Task BE-1.3: HighLevel runtime manifest and models

**Files:**
- Create: `functions/src/contracts/hl-runtime.ts`
- Test: `functions/test/unit/contracts/hl-runtime.test.ts`

**Interfaces:**
- Produces: model schemas/types `Location`, `Contact`, `Conversation`, `Message`, `Calendar`, `CalendarEvent`, `Page<T>` (`pageSchema(item)`); params schemas `EmptyParams`, `ContactsListParams`, `ContactGetParams`, `ConversationsListParams`, `MessagesListParams`, `CalendarEventsParams`; `RUNTIME_METHOD_NAMES` (seven reads), `RuntimeMethodName`, `RuntimeMethodSpec`, `RUNTIME_METHODS`, `scopesForMethods(methods)`, `availableMethodNames(enabled, grantedScopes)`, `RuntimeParams<M>`, `pathParamNames(path)`, `HL_SCOPES`.

> What to Build and the Loom require **real contacts, conversations, or appointments**. Create/update/send/availability are prerequisite “familiarize” verbs, not product methods. The manifest is the seven read methods; every consumer asks it what exists — nothing else hard-codes a method list.

- [ ] **Step 1: Write the failing test**

```ts
import { DEFAULT_HL_SCOPES } from '../../../src/config/params.js';
import {
  availableMethodNames, ContactsListParams,
  pathParamNames, RUNTIME_METHOD_NAMES, RUNTIME_METHODS, scopesForMethods,
} from '../../../src/contracts/hl-runtime.js';

describe('runtime manifest', () => {
  it('has a spec for every method and path params exist in the schema', () => {
    for (const name of RUNTIME_METHOD_NAMES) {
      const spec = RUNTIME_METHODS[name];
      const shape = (spec.params as unknown as { shape?: Record<string, unknown> }).shape ?? {};
      for (const p of pathParamNames(spec.path)) expect(Object.keys(shape)).toContain(p);
    }
  });
  it('is the seven read methods', () => {
    expect([...RUNTIME_METHOD_NAMES]).toEqual(['location.get', 'contacts.list', 'contacts.get', 'conversations.list', 'conversations.messages', 'calendars.list', 'calendars.events']);
    expect(RUNTIME_METHOD_NAMES.every((m) => !RUNTIME_METHODS[m].write)).toBe(true);
  });
  it('keeps the default OAuth scopes equal to what the methods need', () => {
    expect(scopesForMethods(RUNTIME_METHOD_NAMES).join(' ')).toBe(DEFAULT_HL_SCOPES);
  });
  it('offers only methods whose scopes were granted (all when not connected)', () => {
    expect(availableMethodNames(RUNTIME_METHOD_NAMES, null)).toEqual([...RUNTIME_METHOD_NAMES]);
    expect(availableMethodNames(RUNTIME_METHOD_NAMES, ['contacts.readonly', 'locations.readonly'])).toEqual(['location.get', 'contacts.list', 'contacts.get']);
  });
  it('coerces and defaults limit', () => {
    expect(ContactsListParams.parse({ limit: '5' })).toEqual({ limit: 5 });
    expect(ContactsListParams.parse({})).toEqual({ limit: 20 });
    expect(() => ContactsListParams.parse({ limit: 500 })).toThrow();
    expect(() => ContactsListParams.parse({ bogus: 1 })).toThrow();
  });
  it('enforces the 31-day calendar window', () => {
    expect(CalendarEventsParams.parse({ from: '2026-10-01T00:00:00Z', to: '2026-10-20T00:00:00Z' })).toBeTruthy();
    expect(() => CalendarEventsParams.parse({ from: '2026-10-01T00:00:00Z', to: '2026-11-15T00:00:00Z' })).toThrow();
    expect(() => CalendarEventsParams.parse({ from: '2026-10-20T00:00:00Z', to: '2026-10-01T00:00:00Z' })).toThrow();
  });
  it('requires a subject for email', () => {
    expect(() => SendMessageParams.parse({ contactId: 'c1', type: 'Email', message: 'hi' })).toThrow();
    expect(SendMessageParams.parse({ contactId: 'c1', type: 'SMS', message: 'hi' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement `hl-runtime.ts`**

```ts
import { z } from 'zod';
import { LIMITS } from './limits.js';

export const HL_SCOPES = [
  'contacts.readonly', 'contacts.write', 'conversations.readonly', 'conversations/message.readonly',
  'conversations/message.write', 'calendars.readonly', 'calendars/events.readonly', 'locations.readonly',
] as const;

// ── Models (what generated code receives) ────────────────────────────────────
export const LocationSchema = z.object({ id: z.string(), name: z.string(), timezone: z.string().nullable() });
export type Location = z.infer<typeof LocationSchema>;

export const ContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  companyName: z.string().nullable(),
  tags: z.array(z.string()),
  dateAdded: z.string().nullable(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const ConversationSchema = z.object({
  id: z.string(),
  contactId: z.string().nullable(),
  contactName: z.string().nullable(),
  lastMessageBody: z.string().nullable(),
  lastMessageType: z.string().nullable(),
  lastMessageDate: z.string().nullable(),
  unreadCount: z.number(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  body: z.string().nullable(),
  direction: z.enum(['inbound', 'outbound']),
  type: z.string().nullable(),
  status: z.string().nullable(),
  dateAdded: z.string().nullable(),
});
export type Message = z.infer<typeof MessageSchema>;

export const CalendarSchema = z.object({ id: z.string(), name: z.string(), description: z.string().nullable(), isActive: z.boolean() });
export type Calendar = z.infer<typeof CalendarSchema>;

export const CalendarEventSchema = z.object({
  id: z.string(),
  calendarId: z.string(),
  title: z.string().nullable(),
  status: z.string().nullable(),
  contactId: z.string().nullable(),
  startTime: z.string(),
  endTime: z.string(),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const FreeSlotsSchema = z.object({
  calendarId: z.string(),
  timezone: z.string().nullable(),
  days: z.array(z.object({ date: z.string(), slots: z.array(z.string()) })),
});
export type FreeSlots = z.infer<typeof FreeSlotsSchema>;

export const SendMessageResultSchema = z.object({ conversationId: z.string().nullable(), messageId: z.string().nullable() });
export type SendMessageResult = z.infer<typeof SendMessageResultSchema>;

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable(), hasMore: z.boolean() });
export interface Page<T> { items: T[]; nextCursor: string | null; hasMore: boolean }
export interface ItemsResult<T> { items: T[] }

// ── Params (what generated code sends) ───────────────────────────────────────
const HlId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/, 'Invalid id');
const Limit = z.coerce.number().int().min(1).max(LIMITS.pageLimitMax).default(LIMITS.pageLimitDefault);
const Cursor = z.string().min(1).max(2_048);
const Query = z.string().trim().max(200);
const IsoDateTime = z.iso.datetime({ offset: true });
const MAX_RANGE_MS = LIMITS.calendarRangeMaxDays * 24 * 60 * 60 * 1000;

const rangeOk = (v: { from: string; to: string }) => {
  const span = Date.parse(v.to) - Date.parse(v.from);
  return span > 0 && span <= MAX_RANGE_MS;
};
const RANGE_MESSAGE = { message: `"to" must be after "from" and at most ${LIMITS.calendarRangeMaxDays} days later`, path: ['to'] };

const contactFields = {
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  email: z.email().max(254).optional(),
  phone: z.string().trim().regex(/^[+0-9 ()-]{3,32}$/, 'Invalid phone').optional(),
  companyName: z.string().trim().min(1).max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
};

export const EmptyParams = z.strictObject({});
export const ContactsListParams = z.strictObject({ query: Query.optional(), limit: Limit, cursor: Cursor.optional() });
export const ContactGetParams = z.strictObject({ contactId: HlId });
export const ContactCreateParams = z
  .strictObject(contactFields)
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field' });
export const ContactUpdateParams = z
  .strictObject({ contactId: HlId, ...contactFields })
  .refine(({ contactId: _id, ...rest }) => Object.values(rest).some((x) => x !== undefined), { message: 'Provide at least one field to update' });
export const ConversationsListParams = z.strictObject({ query: Query.optional(), contactId: HlId.optional(), limit: Limit, cursor: Cursor.optional() });
export const MessagesListParams = z.strictObject({ conversationId: HlId, limit: Limit, cursor: Cursor.optional() });
export const SendMessageParams = z
  .strictObject({
    contactId: HlId,
    type: z.enum(['SMS', 'Email']),
    message: z.string().trim().min(1).max(1_600),
    subject: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => v.type !== 'Email' || v.subject !== undefined, { message: 'subject is required for Email', path: ['subject'] });
export const CalendarEventsParams = z
  .strictObject({ from: IsoDateTime, to: IsoDateTime, calendarId: HlId.optional() })
  .refine(rangeOk, RANGE_MESSAGE);
export const FreeSlotsParams = z
  .strictObject({ calendarId: HlId, from: IsoDateTime, to: IsoDateTime, timezone: z.string().max(64).optional() })
  .refine(rangeOk, RANGE_MESSAGE);

// ── Manifest ─────────────────────────────────────────────────────────────────
export const RUNTIME_METHOD_NAMES = [
  'location.get',
  'contacts.list', 'contacts.get',
  'conversations.list', 'conversations.messages',
  'calendars.list', 'calendars.events',
] as const;
export type RuntimeMethodName = (typeof RUNTIME_METHOD_NAMES)[number];

export interface RuntimeMethodSpec {
  readonly verb: 'GET';
  /** Relative to /v1/projects/:projectId */
  readonly path: string;
  readonly params: z.ZodType;
  readonly write: boolean;
  readonly scopes: readonly (typeof HL_SCOPES)[number][];
}

export const RUNTIME_METHODS = {
  'location.get': { verb: 'GET', path: '/hl/location', params: EmptyParams, write: false, scopes: ['locations.readonly'] },
  'contacts.list': { verb: 'GET', path: '/hl/contacts', params: ContactsListParams, write: false, scopes: ['contacts.readonly'] },
  'contacts.get': { verb: 'GET', path: '/hl/contacts/:contactId', params: ContactGetParams, write: false, scopes: ['contacts.readonly'] },
  'conversations.list': { verb: 'GET', path: '/hl/conversations', params: ConversationsListParams, write: false, scopes: ['conversations.readonly'] },
  'conversations.messages': { verb: 'GET', path: '/hl/conversations/:conversationId/messages', params: MessagesListParams, write: false, scopes: ['conversations/message.readonly'] },
  'calendars.list': { verb: 'GET', path: '/hl/calendars', params: EmptyParams, write: false, scopes: ['calendars.readonly'] },
  'calendars.events': { verb: 'GET', path: '/hl/calendars/events', params: CalendarEventsParams, write: false, scopes: ['calendars.readonly', 'calendars/events.readonly'] },
} as const satisfies Record<RuntimeMethodName, RuntimeMethodSpec>;

export type RuntimeParams<M extends RuntimeMethodName> = z.input<(typeof RUNTIME_METHODS)[M]['params']>;
export type RuntimeParsedParams<M extends RuntimeMethodName> = z.output<(typeof RUNTIME_METHODS)[M]['params']>;

/** OAuth scopes the given methods need, deduplicated, in HL_SCOPES order. */
export const scopesForMethods = (methods: readonly RuntimeMethodName[]): (typeof HL_SCOPES)[number][] => {
  const needed = new Set(methods.flatMap((m) => RUNTIME_METHODS[m].scopes));
  return HL_SCOPES.filter((s) => needed.has(s));
};

/**
 * Methods the connection can actually call. Without a connection (null/empty grant) all
 * methods are described, so generated apps target them and show "connect HighLevel" errors.
 */
export const availableMethodNames = (
  enabled: readonly RuntimeMethodName[],
  grantedScopes: readonly string[] | null,
): RuntimeMethodName[] =>
  !grantedScopes || grantedScopes.length === 0
    ? [...enabled]
    : enabled.filter((m) => RUNTIME_METHODS[m].scopes.every((s) => grantedScopes.includes(s)));

export const pathParamNames = (path: string): string[] => [...path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1] ?? '');
```

- [ ] **Step 3: Run tests** → PASS. **Step 4: Commit** — `feat(contracts): add HighLevel runtime manifest, params and models`.

---

### Task BE-1.4: REST DTOs

**Files:**
- Create: `functions/src/contracts/api.ts`
- Test: `functions/test/unit/contracts/api.test.ts`

**Interfaces:**
- Produces: `DocId`, `OAuthStartBody`, `OAuthStartResult`, `OAuthCallbackQuery`, `OAUTH_REDIRECT_REASONS`/`OAuthRedirectReason`, `ProjectParams`, `FileSaveParams`, `FileSaveBody`, `FileSaveResult`, `RestoreParams`, `RestoreResult`, `GenerationParams`, `ApplyResult`, `DiscardResult`, `StartGenerationBody`, `DisconnectResult`, `HealthResult`, `apiSuccess(schema)`.

- [ ] **Step 1: Write the failing test**

```ts
import { FileSaveParams, OAuthStartBody, StartGenerationBody } from '../../../src/contracts/api.js';

describe('api contracts', () => {
  it('validates generation start', () => {
    const ok = StartGenerationBody.parse({ clientRequestId: '6f1f8d0e-4a5b-4c3d-9e2f-1a2b3c4d5e6f', prompt: '  Build a dashboard  ' });
    expect(ok.prompt).toBe('Build a dashboard');
    expect(() => StartGenerationBody.parse({ clientRequestId: 'x', prompt: 'a' })).toThrow();
    expect(() => StartGenerationBody.parse({ clientRequestId: '6f1f8d0e-4a5b-4c3d-9e2f-1a2b3c4d5e6f', prompt: '' })).toThrow();
  });
  it('only accepts internal return paths', () => {
    expect(OAuthStartBody.parse({ returnPath: '/dashboard' })).toBeTruthy();
    expect(() => OAuthStartBody.parse({ returnPath: '//evil.com' })).toThrow();
    expect(() => OAuthStartBody.parse({ returnPath: 'https://evil.com' })).toThrow();
  });
  it('accepts only 20-hex file ids', () => {
    expect(FileSaveParams.parse({ projectId: 'abc', fileId: 'a'.repeat(20) })).toBeTruthy();
    expect(() => FileSaveParams.parse({ projectId: 'abc', fileId: '../x' })).toThrow();
  });
});
```

- [ ] **Step 2: Implement `api.ts`**

```ts
import { z } from 'zod';
import { LIMITS } from './limits.js';

export const DocId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/, 'Invalid id');
const FileId = z.string().regex(/^[0-9a-f]{20}$/, 'Invalid file id');
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const apiSuccess = <T extends z.ZodType>(data: T) => z.object({ data });

// OAuth
export const OAuthStartBody = z.strictObject({
  returnPath: z.string().max(200).regex(/^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/, 'Must be an internal path').optional(),
});
export const OAuthStartResult = z.object({ authorizeUrl: z.url() });
export const OAuthCallbackQuery = z.object({
  code: z.string().min(1).max(2_048).optional(),
  state: z.string().min(1).max(256).optional(),
  error: z.string().max(200).optional(),
});
export const OAUTH_REDIRECT_REASONS = ['state_invalid', 'denied', 'exchange_failed', 'not_location_token', 'internal'] as const;
export type OAuthRedirectReason = (typeof OAUTH_REDIRECT_REASONS)[number];
export const DisconnectResult = z.object({ status: z.literal('disconnected') });

// Projects / files / snapshots
export const ProjectParams = z.object({ projectId: DocId });
export const FileSaveParams = z.object({ projectId: DocId, fileId: FileId });
export const FileSaveBody = z.strictObject({
  content: z.string().max(LIMITS.maxFileBytes), // UTF-16 length bound; byte bound enforced in the service
  expectedVersion: z.number().int().min(1),
});
export const FileSaveResult = z.object({ fileId: FileId, path: z.string(), version: z.number().int(), sizeBytes: z.number().int(), contentHash: Sha256 });
export type FileSaveResult = z.infer<typeof FileSaveResult>;

export const RestoreParams = z.object({ projectId: DocId, snapshotId: DocId });
export const RestoreResult = z.object({
  snapshotId: z.string(),
  snapshotSeq: z.number().int(),
  restoredFromSnapshotId: z.string(),
  checkpointSnapshotId: z.string().nullable(),
});
export type RestoreResult = z.infer<typeof RestoreResult>;

// Generations
export const StartGenerationBody = z.strictObject({
  clientRequestId: z.uuid(),
  prompt: z.string().trim().min(1).max(LIMITS.promptMaxChars),
});
export type StartGenerationBody = z.infer<typeof StartGenerationBody>;
export const GenerationParams = z.object({ projectId: DocId, generationId: z.uuid() });
export const ApplyResult = z.object({
  snapshotId: z.string(),
  snapshotSeq: z.number().int(),
  appliedPaths: z.array(z.string()),
  deletedPaths: z.array(z.string()),
});
export type ApplyResult = z.infer<typeof ApplyResult>;
export const DiscardResult = z.object({ discarded: z.literal(true) });

export const HealthResult = z.object({ ok: z.literal(true), service: z.string(), version: z.string() });
```

- [ ] **Step 3: Run tests** → PASS. **Step 4: Commit** — `feat(contracts): add REST request/response contracts`.

---

### Task BE-1.5: SSE events and preview-bridge messages

**Files:**
- Create: `functions/src/contracts/sse.ts`, `functions/src/contracts/bridge.ts`
- Test: `functions/test/unit/contracts/sse.test.ts`

**Interfaces:**
- Produces: `SSE_PROTOCOL_VERSION = 1`, `GenerationPhase`, `GenerationEventSchema` (discriminated union on `type`), `GenerationEvent`, `GenerationEventType`, `GenerationEventData<T>`, `TERMINAL_EVENT_TYPES`, `isTerminalEvent(e)`; bridge: `BRIDGE_PROTOCOL_VERSION = 1`, `HelloMessageSchema`, `PreviewContextSchema`/`PreviewContext`, `InitMessage`, `PortInboundSchema`/`PortInbound`, `RpcResultMessage`, `HostEventMessage`, `RpcErrorPayload`.

- [ ] **Step 1: Write the failing test**

```ts
import { GenerationEventSchema, isTerminalEvent } from '../../../src/contracts/sse.js';

const base = { v: 1, seq: 1, generationId: 'g', ts: 1 };

describe('SSE contracts', () => {
  it('parses each event family', () => {
    expect(GenerationEventSchema.parse({ ...base, type: 'file.delta', data: { path: 'app.js', text: 'x' } }).type).toBe('file.delta');
    const failed = GenerationEventSchema.parse({
      ...base, seq: 9, type: 'generation.failed',
      data: { error: { code: 'LLM_UNAVAILABLE', message: 'down', retryable: true }, partial: { stagedPaths: ['index.html'], applyable: true } },
    });
    expect(isTerminalEvent(failed)).toBe(true);
  });
  it('rejects unknown types and wrong versions', () => {
    expect(() => GenerationEventSchema.parse({ ...base, type: 'nope', data: {} })).toThrow();
    expect(() => GenerationEventSchema.parse({ ...base, v: 2, type: 'heartbeat', data: {} })).toThrow();
  });
});
```

- [ ] **Step 2: Implement `sse.ts`**

```ts
import { z } from 'zod';
import { ErrorCodeSchema } from './errors.js';
import { IssueSchema, PartialResultSchema, UsageSchema } from './firestore-docs.js';
import { FileLanguageSchema } from './paths.js';

export const SSE_PROTOCOL_VERSION = 1 as const;

export const GenerationPhaseSchema = z.enum(['context', 'thinking', 'writing', 'validating', 'committing']);
export type GenerationPhase = z.infer<typeof GenerationPhaseSchema>;

const envelope = <T extends string, D extends z.ZodType>(type: T, data: D) =>
  z.object({
    v: z.literal(SSE_PROTOCOL_VERSION),
    seq: z.number().int().min(1),
    generationId: z.string().min(1),
    ts: z.number(),
    type: z.literal(type),
    data,
  });

const RejectedFile = z.object({ path: z.string(), issues: z.array(IssueSchema) });

export const GenerationEventSchema = z.discriminatedUnion('type', [
  envelope('generation.started', z.object({ projectId: z.string(), model: z.string(), promptVersion: z.string(), startedAt: z.string() })),
  envelope('generation.phase', z.object({ phase: GenerationPhaseSchema })),
  envelope('assistant.thinking', z.object({ text: z.string() })),
  envelope('assistant.delta', z.object({ text: z.string() })),
  envelope('file.started', z.object({ path: z.string(), language: FileLanguageSchema, op: z.literal('write') })),
  envelope('file.delta', z.object({ path: z.string(), text: z.string() })),
  envelope('file.completed', z.object({
    path: z.string(),
    status: z.enum(['valid', 'rejected']),
    sizeBytes: z.number().int().min(0),
    sha256: z.string(),
    issues: z.array(IssueSchema),
  })),
  envelope('file.deleted', z.object({ path: z.string(), status: z.enum(['valid', 'rejected']), issues: z.array(IssueSchema) })),
  envelope('heartbeat', z.object({})),
  envelope('generation.completed', z.object({
    snapshotId: z.string(),
    snapshotSeq: z.number().int(),
    changedPaths: z.array(z.string()),
    deletedPaths: z.array(z.string()),
    rejected: z.array(RejectedFile),
    warnings: z.array(IssueSchema),
    noChanges: z.boolean(),
    usage: UsageSchema,
    durationMs: z.number().min(0),
  })),
  envelope('generation.failed', z.object({
    error: z.object({ code: ErrorCodeSchema, message: z.string(), retryable: z.boolean() }),
    partial: PartialResultSchema.nullable(),
  })),
]);

export type GenerationEvent = z.infer<typeof GenerationEventSchema>;
export type GenerationEventType = GenerationEvent['type'];
export type GenerationEventData<T extends GenerationEventType> = Extract<GenerationEvent, { type: T }>['data'];

export const TERMINAL_EVENT_TYPES = ['generation.completed', 'generation.failed'] as const;
export const isTerminalEvent = (e: GenerationEvent): boolean =>
  (TERMINAL_EVENT_TYPES as readonly string[]).includes(e.type);
```

- [ ] **Step 3: Implement `bridge.ts`**

```ts
import { z } from 'zod';
import { LocationSchema, type RuntimeEventName } from './hl-runtime.js';

export const BRIDGE_PROTOCOL_VERSION = 1 as const;

export const HelloMessageSchema = z.object({
  source: z.literal('genesis-preview'),
  type: z.literal('hello'),
  protocol: z.literal(BRIDGE_PROTOCOL_VERSION),
  nonce: z.string().min(8).max(128),
});

export const PreviewContextSchema = z.object({
  location: LocationSchema.nullable(),
  project: z.object({ id: z.string(), name: z.string() }),
  hlStatus: z.enum(['connected', 'reauth_required', 'disconnected']),
});
export type PreviewContext = z.infer<typeof PreviewContextSchema>;

export interface InitMessage {
  source: 'genesis-host';
  type: 'init';
  protocol: typeof BRIDGE_PROTOCOL_VERSION;
  nonce: string;
  context: PreviewContext;
}

export const PortInboundSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rpc'), id: z.string().min(1).max(64), method: z.string().min(1).max(64), params: z.unknown() }),
  z.object({ type: z.literal('console'), level: z.enum(['log', 'info', 'warn', 'error']), args: z.array(z.string().max(2_048)).max(20) }),
  z.object({ type: z.literal('runtime-error'), message: z.string().max(2_048), stack: z.string().max(8_192).optional() }),
]);
export type PortInbound = z.infer<typeof PortInboundSchema>;

export interface RpcErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
}
export type RpcResultMessage =
  | { type: 'rpc-result'; id: string; ok: true; result: unknown }
  | { type: 'rpc-result'; id: string; ok: false; error: RpcErrorPayload };
export interface HostEventMessage {
  type: 'event';
  name: RuntimeEventName;
  payload: Record<string, unknown>;
}
```

- [ ] **Step 4: Run tests** → PASS. **Step 5: Commit** — `feat(contracts): add SSE protocol v1 and preview bridge messages`.

---

### Task BE-1.6: Contracts index, sync script, drift check

**Files:**
- Create: `functions/src/contracts/index.ts`, `scripts/sync-contracts.mjs`
- Test: CI step `npm run contracts:check` (root)

**Interfaces:** Produces `import { … } from '<rel>/contracts/index.js'` barrel; root scripts `contracts:sync` and `contracts:check`.

- [ ] **Step 1: Create `contracts/index.ts`**

```ts
export * from './errors.js';
export * from './limits.js';
export * from './paths.js';
export * from './firestore-docs.js';
export * from './hl-runtime.js';
export * from './api.js';
export * from './sse.js';
export * from './bridge.js';
```

- [ ] **Step 2: Create `scripts/sync-contracts.mjs`**

```js
#!/usr/bin/env node
// Copies functions/src/contracts/*.ts → frontend/src/contracts/ with a generated header.
// `--check` exits 1 when the frontend copy is missing, stale or has extra files.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'functions', 'src', 'contracts');
const DEST = join(root, 'frontend', 'src', 'contracts');
const HEADER =
  '// GENERATED FILE — DO NOT EDIT.\n// Source of truth: functions/src/contracts. Run `npm run contracts:sync` from the repo root.\n\n';
const check = process.argv.includes('--check');

const listTs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.ts')).sort() : []);

if (!existsSync(join(root, 'frontend', 'package.json'))) {
  console.log('frontend/ not initialized yet — skipping contracts sync');
  process.exit(0);
}

const expected = new Map(listTs(SRC).map((f) => [f, HEADER + readFileSync(join(SRC, f), 'utf8')]));

if (check) {
  const problems = [];
  for (const [file, content] of expected) {
    const target = join(DEST, file);
    if (!existsSync(target) || readFileSync(target, 'utf8') !== content) problems.push(`stale or missing: frontend/src/contracts/${file}`);
  }
  for (const file of listTs(DEST)) if (!expected.has(file)) problems.push(`unexpected: frontend/src/contracts/${file}`);
  if (problems.length > 0) {
    console.error(`Contracts drift detected:\n  ${problems.join('\n  ')}\nRun: npm run contracts:sync`);
    process.exit(1);
  }
  console.log(`contracts in sync (${expected.size} files)`);
  process.exit(0);
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
for (const [file, content] of expected) writeFileSync(join(DEST, file), content);
console.log(`synced ${expected.size} contract files → frontend/src/contracts`);
```

- [ ] **Step 3: Verify** — `node scripts/sync-contracts.mjs --check` prints "frontend/ not initialized yet — skipping" (until FE-0.1 runs); after the frontend exists, `npm run contracts:sync` then `npm run contracts:check` → "contracts in sync (9 files)".

- [ ] **Step 4: Run all functions checks** — `npm --prefix functions run lint && npm --prefix functions run typecheck && npm --prefix functions test` → clean.

- [ ] **Step 5: Commit** — `git add functions/src/contracts scripts && git commit -m "feat(contracts): add barrel and frontend sync with drift check"`.
