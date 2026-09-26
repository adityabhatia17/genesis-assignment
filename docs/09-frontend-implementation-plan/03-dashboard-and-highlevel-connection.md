# FE-2 — Firestore data layer, HighLevel connection, projects dashboard

> Read [`00-overview.md`](00-overview.md) first. Spec: [`../06-frontend-system-design.md`](../06-frontend-system-design.md) §5, §7, §8; contracts: [`../07-end-to-end-system-design.md`](../07-end-to-end-system-design.md) §3.1 (A2–A4), §3.5; flows §4.2, §4.4, §4.15. Rules the client writes must satisfy: BE-2.1.

---

### Task FE-2.1: Firestore references, converters and realtime composables

**Files:**
- Create: `frontend/src/services/firestore/types.ts`, `converters.ts`, `paths.ts`, `frontend/src/composables/firestore-errors.ts`, `useFirestoreDoc.ts`, `useFirestoreQuery.ts`
- Test: `frontend/tests/composables/useFirestoreQuery.test.ts`

**Interfaces:**
- Produces: `WithId<T>`, `Integration`, `Project`, `ProjectFile`, `ChatMessage`, `Generation`, `Snapshot`, `BlobRecord`, `UserEvent`; `readConverter<T>()`; `refs.{integration, projects, projectsRaw, project, projectRaw, files, messages, generations, generation, snapshots, snapshot, blob, events}`; `useFirestoreDoc(source) → { data, loading, error, retry }`, `useFirestoreQuery(source) → { data, loading, error, retry }`; `isSignedOutDenial(error)`.

- [ ] **Step 1: Failing test**

`frontend/tests/composables/useFirestoreQuery.test.ts`:
```ts
import { effectScope, nextTick, ref } from 'vue';

const onSnapshot = vi.fn();
vi.mock('firebase/firestore', () => ({
  onSnapshot: (...args: unknown[]) => onSnapshot(...args) as unknown,
  queryEqual: (a: unknown, b: unknown) => a === b,
}));
vi.mock('@/lib/firebase', () => ({ auth: () => ({ currentUser: null }) }));

const { useFirestoreQuery } = await import('@/composables/useFirestoreQuery');

describe('useFirestoreQuery', () => {
  // Block body: Vitest treats a function returned from beforeEach as a cleanup hook.
  beforeEach(() => {
    onSnapshot.mockReset();
  });

  it('subscribes, delivers data and unsubscribes with its scope', () => {
    const unsubscribe = vi.fn();
    onSnapshot.mockImplementation((_q, next: (s: unknown) => void) => {
      next({ docs: [{ data: () => ({ id: 'a' }) }] });
      return unsubscribe;
    });
    const scope = effectScope();
    const state = scope.run(() => useFirestoreQuery(() => ({ q: 1 }) as never))!;
    expect(state.data.value).toEqual([{ id: 'a' }]);
    expect(state.loading.value).toBe(false);
    scope.stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('resubscribes when the query changes and clears for null', async () => {
    onSnapshot.mockReturnValue(vi.fn());
    const source = ref<object | null>({ q: 1 });
    const scope = effectScope();
    const state = scope.run(() => useFirestoreQuery(() => source.value as never))!;
    source.value = { q: 2 };
    await nextTick();
    expect(onSnapshot).toHaveBeenCalledTimes(2);
    source.value = null;
    await nextTick();
    expect(state.data.value).toEqual([]);
    scope.stop();
  });

  it('ignores permission-denied right after sign-out', () => {
    onSnapshot.mockImplementation((_q, _next, error: (e: unknown) => void) => {
      error({ code: 'permission-denied' });
      return vi.fn();
    });
    const scope = effectScope();
    const state = scope.run(() => useFirestoreQuery(() => ({}) as never))!;
    expect(state.error.value).toBeNull();
    scope.stop();
  });
});
```

- [ ] **Step 2: Implement**

`frontend/src/services/firestore/types.ts`:
```ts
import type { Timestamp } from 'firebase/firestore';
import type {
  BlobDoc,
  FileDoc,
  GenerationDoc,
  IntegrationDoc,
  MessageDoc,
  ProjectDoc,
  SnapshotDoc,
  UserEventDoc,
} from '@/contracts/firestore-docs';

export type WithId<T> = T & { readonly id: string };

export type Integration = WithId<IntegrationDoc<Timestamp>>;
export type Project = WithId<ProjectDoc<Timestamp>>;
export type ProjectFile = WithId<FileDoc<Timestamp>>;
export type ChatMessage = WithId<MessageDoc<Timestamp>>;
export type Generation = WithId<GenerationDoc<Timestamp>>;
export type Snapshot = WithId<SnapshotDoc<Timestamp>>;
export type BlobRecord = WithId<BlobDoc<Timestamp>>;
export type UserEvent = WithId<UserEventDoc<Timestamp>>;
```

`frontend/src/services/firestore/converters.ts`:
```ts
import type {
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  SnapshotOptions,
} from 'firebase/firestore';
import type { WithId } from './types';

/**
 * Read-only converter: adds the document id and reads pending server timestamps as local estimates.
 * Client writes use untyped references (they need serverTimestamp()).
 */
export function readConverter<T>(): FirestoreDataConverter<WithId<T>> {
  return {
    toFirestore(): never {
      throw new Error('Read-only converter: write with an untyped reference.');
    },
    fromFirestore(snapshot: QueryDocumentSnapshot, options?: SnapshotOptions): WithId<T> {
      const data = snapshot.data({ ...options, serverTimestamps: 'estimate' }) as T;
      return { ...data, id: snapshot.id };
    },
  };
}
```

`frontend/src/services/firestore/paths.ts`:
```ts
import type { Timestamp } from 'firebase/firestore';
import { collection, doc } from 'firebase/firestore';
import type {
  BlobDoc,
  FileDoc,
  GenerationDoc,
  IntegrationDoc,
  MessageDoc,
  ProjectDoc,
  SnapshotDoc,
  UserEventDoc,
} from '@/contracts/firestore-docs';
import { db } from '@/lib/firebase';
import { readConverter } from './converters';

const project = (uid: string, pid: string) => ['users', uid, 'projects', pid] as const;

/** Typed references for every path the SPA reads (07 §3.5). `*Raw` references are for client writes. */
export const refs = {
  integration: (uid: string) =>
    doc(db(), 'users', uid, 'integrations', 'highlevel').withConverter(
      readConverter<IntegrationDoc<Timestamp>>(),
    ),
  projects: (uid: string) =>
    collection(db(), 'users', uid, 'projects').withConverter(
      readConverter<ProjectDoc<Timestamp>>(),
    ),
  projectsRaw: (uid: string) => collection(db(), 'users', uid, 'projects'),
  project: (uid: string, pid: string) =>
    doc(db(), ...project(uid, pid)).withConverter(readConverter<ProjectDoc<Timestamp>>()),
  projectRaw: (uid: string, pid: string) => doc(db(), ...project(uid, pid)),
  files: (uid: string, pid: string) =>
    collection(db(), ...project(uid, pid), 'files').withConverter(
      readConverter<FileDoc<Timestamp>>(),
    ),
  messages: (uid: string, pid: string) =>
    collection(db(), ...project(uid, pid), 'messages').withConverter(
      readConverter<MessageDoc<Timestamp>>(),
    ),
  generations: (uid: string, pid: string) =>
    collection(db(), ...project(uid, pid), 'generations').withConverter(
      readConverter<GenerationDoc<Timestamp>>(),
    ),
  generation: (uid: string, pid: string, gid: string) =>
    doc(db(), ...project(uid, pid), 'generations', gid).withConverter(
      readConverter<GenerationDoc<Timestamp>>(),
    ),
  snapshots: (uid: string, pid: string) =>
    collection(db(), ...project(uid, pid), 'snapshots').withConverter(
      readConverter<SnapshotDoc<Timestamp>>(),
    ),
  snapshot: (uid: string, pid: string, sid: string) =>
    doc(db(), ...project(uid, pid), 'snapshots', sid).withConverter(
      readConverter<SnapshotDoc<Timestamp>>(),
    ),
  blob: (uid: string, pid: string, blobId: string) =>
    doc(db(), ...project(uid, pid), 'blobs', blobId).withConverter(
      readConverter<BlobDoc<Timestamp>>(),
    ),
  events: (uid: string) =>
    collection(db(), 'users', uid, 'events').withConverter(
      readConverter<UserEventDoc<Timestamp>>(),
    ),
};
```

`frontend/src/composables/firestore-errors.ts`:
```ts
import type { FirestoreError } from 'firebase/firestore';
import { auth } from '@/lib/firebase';

/** Listeners fail with permission-denied for a moment after sign-out; that is not an error to show. */
export function isSignedOutDenial(error: FirestoreError): boolean {
  return error.code === 'permission-denied' && auth().currentUser === null;
}
```

`frontend/src/composables/useFirestoreDoc.ts`:
```ts
import {
  onSnapshot,
  refEqual,
  type DocumentReference,
  type FirestoreError,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
  type ShallowRef,
} from 'vue';
import { isSignedOutDenial } from './firestore-errors';

export interface FirestoreDocState<T> {
  data: ShallowRef<T | null>;
  loading: Ref<boolean>;
  error: ShallowRef<FirestoreError | null>;
  retry: () => void;
}

/** Realtime document; re-subscribes when the reference changes and unsubscribes with the scope. */
export function useFirestoreDoc<T>(
  source: MaybeRefOrGetter<DocumentReference<T> | null>,
): FirestoreDocState<T> {
  const data = shallowRef<T | null>(null);
  const loading = ref(true);
  const error = shallowRef<FirestoreError | null>(null);
  const attempt = ref(0);
  let unsubscribe: Unsubscribe | null = null;
  let current: DocumentReference<T> | null = null;
  let currentAttempt = -1;

  const stop = watch(
    [() => toValue(source), attempt],
    ([next, nextAttempt]) => {
      if (next && current && refEqual(next, current) && nextAttempt === currentAttempt) return;
      unsubscribe?.();
      unsubscribe = null;
      current = next;
      currentAttempt = nextAttempt;
      error.value = null;
      if (!next) {
        data.value = null;
        loading.value = false;
        return;
      }
      loading.value = true;
      unsubscribe = onSnapshot(
        next,
        (snap) => {
          data.value = snap.exists() ? (snap.data() ?? null) : null;
          loading.value = false;
        },
        (e) => {
          if (isSignedOutDenial(e)) return;
          error.value = e;
          loading.value = false;
        },
      );
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    stop();
    unsubscribe?.();
  });

  return { data, loading, error, retry: () => void (attempt.value += 1) };
}
```

`frontend/src/composables/useFirestoreQuery.ts`:
```ts
import {
  onSnapshot,
  queryEqual,
  type FirestoreError,
  type Query,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
  type ShallowRef,
} from 'vue';
import { isSignedOutDenial } from './firestore-errors';

export interface FirestoreQueryState<T> {
  data: ShallowRef<T[]>;
  loading: Ref<boolean>;
  error: ShallowRef<FirestoreError | null>;
  retry: () => void;
}

/** Realtime query results (shallow: a new array per snapshot, documents are not deeply reactive). */
export function useFirestoreQuery<T>(
  source: MaybeRefOrGetter<Query<T> | null>,
): FirestoreQueryState<T> {
  const data = shallowRef<T[]>([]);
  const loading = ref(true);
  const error = shallowRef<FirestoreError | null>(null);
  const attempt = ref(0);
  let unsubscribe: Unsubscribe | null = null;
  let current: Query<T> | null = null;
  let currentAttempt = -1;

  const stop = watch(
    [() => toValue(source), attempt],
    ([next, nextAttempt]) => {
      if (next && current && queryEqual(next, current) && nextAttempt === currentAttempt) return;
      unsubscribe?.();
      unsubscribe = null;
      current = next;
      currentAttempt = nextAttempt;
      error.value = null;
      if (!next) {
        data.value = [];
        loading.value = false;
        return;
      }
      loading.value = true;
      unsubscribe = onSnapshot(
        next,
        (snap) => {
          data.value = snap.docs.map((d) => d.data());
          loading.value = false;
        },
        (e) => {
          if (isSignedOutDenial(e)) return;
          error.value = e;
          loading.value = false;
        },
      );
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    stop();
    unsubscribe?.();
  });

  return { data, loading, error, retry: () => void (attempt.value += 1) };
}
```

- [ ] **Step 3: Run** `npm test` → PASS. **Commit** — `feat(frontend): add typed Firestore references and realtime composables`

---

### Task FE-2.2: HighLevel connection — status, connect, disconnect, OAuth return (R-AUTH3, R-FE2)

**Files:**
- Create: `frontend/src/services/api/hl-oauth.api.ts`, `frontend/src/features/highlevel/useHighLevelConnection.ts`, `connection-query.ts`, `useOAuthReturnToast.ts`, `ConnectionBadge.vue`, `ConnectionCard.vue`, `frontend/src/components/common/AppHeader.vue`
- Test: `frontend/tests/features/highlevel/connection-query.test.ts`, `frontend/tests/features/highlevel/ConnectionBadge.test.ts`

**Interfaces:**
- Produces: `startHighLevelOAuth(returnPath): Promise<string>`, `disconnectHighLevel()`; `useHighLevelConnection() → { status: 'loading' | 'connected' | 'reauth_required' | 'disconnected'; locationId; locationName; timezone; scopes; connecting; disconnecting; connect(returnPath?); disconnect() }` (one shared listener); `readOAuthReturn(query)`, `oauthErrorMessage(reason)`; `useOAuthReturnToast()`.
- Consumes: A2 `POST /v1/hl/oauth/start`, A4 `DELETE /v1/hl/connection`, the projection `users/{uid}/integrations/highlevel` (never tokens).

- [ ] **Step 1: Failing tests**

`frontend/tests/features/highlevel/connection-query.test.ts`:
```ts
import { oauthErrorMessage, readOAuthReturn } from '@/features/highlevel/connection-query';

describe('readOAuthReturn', () => {
  it('reads success and known reasons', () => {
    expect(readOAuthReturn({ hl: 'connected' })).toEqual({ kind: 'connected' });
    expect(readOAuthReturn({ hl: 'error', reason: 'denied' })).toEqual({
      kind: 'error',
      reason: 'denied',
    });
  });
  it('treats unknown reasons as internal and ignores unrelated queries', () => {
    expect(readOAuthReturn({ hl: 'error', reason: '<script>' })).toEqual({
      kind: 'error',
      reason: 'internal',
    });
    expect(readOAuthReturn({})).toBeNull();
  });
  it('has a message for the agency-token case', () => {
    expect(oauthErrorMessage('not_location_token')).toMatch(/sub-account/);
  });
});
```

`frontend/tests/features/highlevel/ConnectionBadge.test.ts`:
```ts
import { mount } from '@vue/test-utils';
import { computed, ref } from 'vue';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ConnectionStatus } from '@/features/highlevel/useHighLevelConnection';

const status = ref<ConnectionStatus>('connected');
vi.mock('@/composables/useAuth', () => ({ useAuth: () => ({ uid: computed(() => 'u1') }) }));
vi.mock('@/features/highlevel/useHighLevelConnection', () => ({
  useHighLevelConnection: () => ({
    status: computed(() => status.value),
    locationName: computed(() => 'Demo Clinic'),
    timezone: computed(() => 'America/New_York'),
    scopes: computed(() => ['contacts.readonly']),
  }),
}));

const { default: ConnectionBadge } = await import('@/features/highlevel/ConnectionBadge.vue');
const render = () =>
  mount({
    components: { TooltipProvider, ConnectionBadge },
    template: '<TooltipProvider><ConnectionBadge /></TooltipProvider>',
  });

describe('ConnectionBadge', () => {
  it.each([
    ['connected', 'Connected · Demo Clinic'],
    ['reauth_required', 'Reconnect HighLevel'],
    ['disconnected', 'Not connected'],
  ] as const)('%s', (value, text) => {
    status.value = value;
    expect(render().get('[data-testid="hl-badge"]').text()).toContain(text);
  });
});
```

- [ ] **Step 2: Implement**

`frontend/src/services/api/hl-oauth.api.ts`:
```ts
import type { z } from 'zod';
import { OAuthStartResult } from '@/contracts/api';
import { apiFetch } from '@/lib/http';

/** Returns the HighLevel authorize URL; the caller navigates the whole tab there. */
export async function startHighLevelOAuth(returnPath: string): Promise<string> {
  const data = await apiFetch<z.infer<typeof OAuthStartResult>>('api', '/v1/hl/oauth/start', {
    method: 'POST',
    body: { returnPath },
  });
  return OAuthStartResult.parse(data).authorizeUrl;
}

export async function disconnectHighLevel(): Promise<void> {
  await apiFetch<unknown>('api', '/v1/hl/connection', { method: 'DELETE' });
}
```

`frontend/src/features/highlevel/useHighLevelConnection.ts`:
```ts
import { createSharedComposable, useEventListener } from '@vueuse/core';
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { toast } from 'vue-sonner';
import type { IntegrationStatus } from '@/contracts/firestore-docs';
import { useAuth } from '@/composables/useAuth';
import { useFirestoreDoc } from '@/composables/useFirestoreDoc';
import { toUserMessage } from '@/lib/errors';
import { disconnectHighLevel, startHighLevelOAuth } from '@/services/api/hl-oauth.api';
import { refs } from '@/services/firestore/paths';

export type ConnectionStatus = 'loading' | IntegrationStatus;

export interface HighLevelConnection {
  status: ComputedRef<ConnectionStatus>;
  locationId: ComputedRef<string | null>;
  locationName: ComputedRef<string | null>;
  timezone: ComputedRef<string | null>;
  scopes: ComputedRef<string[]>;
  connecting: Ref<boolean>;
  disconnecting: Ref<boolean>;
  connect: (returnPath?: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

function createConnection(): HighLevelConnection {
  const { uid } = useAuth();
  const { data, loading } = useFirestoreDoc(() => (uid.value ? refs.integration(uid.value) : null));

  const status = computed<ConnectionStatus>(() =>
    loading.value ? 'loading' : (data.value?.status ?? 'disconnected'),
  );
  const linked = computed(() => status.value === 'connected' || status.value === 'reauth_required');
  const connecting = ref(false);
  const disconnecting = ref(false);

  // Coming back with the browser's Back button restores this page from the bfcache mid-"connecting".
  useEventListener(window, 'pageshow', (event: PageTransitionEvent) => {
    if (event.persisted) connecting.value = false;
  });

  async function connect(returnPath = '/dashboard'): Promise<void> {
    if (connecting.value) return;
    connecting.value = true;
    try {
      window.location.assign(await startHighLevelOAuth(returnPath));
    } catch (error) {
      connecting.value = false;
      toast.error(toUserMessage(error));
    }
  }

  async function disconnect(): Promise<void> {
    if (disconnecting.value) return;
    disconnecting.value = true;
    try {
      await disconnectHighLevel();
      toast.success('HighLevel disconnected');
    } catch (error) {
      toast.error(toUserMessage(error));
    } finally {
      disconnecting.value = false;
    }
  }

  return {
    status,
    locationId: computed(() => (linked.value ? (data.value?.locationId ?? null) : null)),
    locationName: computed(() => (linked.value ? (data.value?.locationName ?? null) : null)),
    timezone: computed(() => (linked.value ? (data.value?.timezone ?? null) : null)),
    scopes: computed(() => data.value?.scopes ?? []),
    connecting,
    disconnecting,
    connect,
    disconnect,
  };
}

/** One Firestore listener for the whole app, shared by the badge, the card and the workspace. */
export const useHighLevelConnection = createSharedComposable(createConnection);
```

`frontend/src/features/highlevel/connection-query.ts`:
```ts
import type { LocationQuery } from 'vue-router';
import { OAUTH_REDIRECT_REASONS, type OAuthRedirectReason } from '@/contracts/api';

export type OAuthReturn = { kind: 'connected' } | { kind: 'error'; reason: OAuthRedirectReason };

/** Reads `?hl=connected` / `?hl=error&reason=…` set by the OAuth callback redirect (07 §3.1 A3). */
export function readOAuthReturn(query: LocationQuery): OAuthReturn | null {
  const hl = query['hl'];
  if (hl === 'connected') return { kind: 'connected' };
  if (hl !== 'error') return null;
  const raw = query['reason'];
  const reason = (OAUTH_REDIRECT_REASONS as readonly unknown[]).includes(raw)
    ? (raw as OAuthRedirectReason)
    : 'internal';
  return { kind: 'error', reason };
}

const MESSAGES: Readonly<Record<OAuthRedirectReason, string>> = {
  state_invalid: 'The connection link expired. Please try again.',
  denied: 'Connection was cancelled.',
  exchange_failed: "HighLevel didn't accept the connection. Please try again.",
  not_location_token: 'Please choose a sub-account (location), not an agency.',
  internal: 'Something went wrong while connecting HighLevel. Please try again.',
};

export const oauthErrorMessage = (reason: OAuthRedirectReason): string => MESSAGES[reason];
```

`frontend/src/features/highlevel/useOAuthReturnToast.ts`:
```ts
import { watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { toast } from 'vue-sonner';
import { oauthErrorMessage, readOAuthReturn } from './connection-query';
import { useHighLevelConnection } from './useHighLevelConnection';

const NAME_WAIT_MS = 4_000;

/** Shows the result of the OAuth round trip once, then removes the query from the URL. */
export function useOAuthReturnToast(): void {
  const route = useRoute();
  const router = useRouter();
  const { locationName } = useHighLevelConnection();
  const result = readOAuthReturn(route.query);
  if (!result) return;
  void router.replace({ query: {} });

  if (result.kind === 'error') {
    toast.error(oauthErrorMessage(result.reason));
    return;
  }
  // The projection may arrive a moment after the redirect; prefer "Connected to <name>".
  let shown = false;
  const show = (name: string | null) => {
    if (shown) return;
    shown = true;
    toast.success(name ? `Connected to ${name}` : 'HighLevel connected');
  };
  const timer = setTimeout(() => {
    stop();
    show(null);
  }, NAME_WAIT_MS);
  const stop = watch(
    locationName,
    (name) => {
      if (!name) return;
      clearTimeout(timer);
      show(name);
      queueMicrotask(() => stop());
    },
    { immediate: true },
  );
}
```

`frontend/src/features/highlevel/ConnectionBadge.vue`:
```vue
<script setup lang="ts">
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/composables/useAuth';
import { useHighLevelConnection } from './useHighLevelConnection';

const { uid } = useAuth();
const { status, locationName, timezone, scopes } = useHighLevelConnection();
</script>

<template>
  <template v-if="uid">
    <Skeleton v-if="status === 'loading'" class="h-5 w-28" />
    <Tooltip v-else-if="status === 'connected'">
      <TooltipTrigger as-child>
        <Badge variant="secondary" class="max-w-60 gap-1.5" data-testid="hl-badge">
          <span class="size-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
          <span class="truncate">Connected · {{ locationName ?? 'HighLevel' }}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {{ timezone ?? 'Timezone unknown' }} · {{ scopes.length }} permissions granted
      </TooltipContent>
    </Tooltip>
    <Badge v-else-if="status === 'reauth_required'" variant="destructive" data-testid="hl-badge">
      Reconnect HighLevel
    </Badge>
    <Badge v-else variant="outline" data-testid="hl-badge">Not connected</Badge>
  </template>
</template>
```

`frontend/src/features/highlevel/ConnectionCard.vue`:
```vue
<script setup lang="ts">
import { PlugIcon, UnplugIcon } from '@lucide/vue';
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { confirmAction } from '@/composables/useConfirm';
import { useHighLevelConnection } from './useHighLevelConnection';

const { status, locationName, timezone, connecting, disconnecting, connect, disconnect } =
  useHighLevelConnection();

const description = computed(() => {
  switch (status.value) {
    case 'connected':
      return 'Generated apps read and write this sub-account through Genesis.';
    case 'reauth_required':
      return 'The connection expired. Reconnect to keep live data in your previews.';
    default:
      return 'Connect a sub-account so previews show your real contacts, conversations and appointments.';
  }
});

async function onDisconnect(): Promise<void> {
  const ok = await confirmAction({
    title: 'Disconnect HighLevel?',
    description: 'Previews stop loading live data until you connect again. Your projects are kept.',
    confirmLabel: 'Disconnect',
    destructive: true,
  });
  if (ok) await disconnect();
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>HighLevel</CardTitle>
      <CardDescription>{{ description }}</CardDescription>
      <CardAction v-if="status !== 'loading'">
        <Button
          v-if="status !== 'connected'"
          size="sm"
          :disabled="connecting"
          @click="connect('/dashboard')"
        >
          <Spinner v-if="connecting" />
          <PlugIcon v-else />
          {{ status === 'reauth_required' ? 'Reconnect' : 'Connect HighLevel' }}
        </Button>
        <Button v-else variant="ghost" size="sm" :disabled="disconnecting" @click="onDisconnect">
          <Spinner v-if="disconnecting" />
          <UnplugIcon v-else />
          Disconnect
        </Button>
      </CardAction>
    </CardHeader>
    <CardContent>
      <Skeleton v-if="status === 'loading'" class="h-4 w-48" />
      <dl
        v-else-if="status !== 'disconnected'"
        class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
      >
        <dt class="text-muted-foreground">Location</dt>
        <dd class="truncate font-medium">{{ locationName ?? '—' }}</dd>
        <dt class="text-muted-foreground">Timezone</dt>
        <dd>{{ timezone ?? '—' }}</dd>
      </dl>
      <p v-else class="text-sm text-muted-foreground">Not connected</p>
    </CardContent>
  </Card>
</template>
```

`frontend/src/components/common/AppHeader.vue`:
```vue
<script setup lang="ts">
import { RouterLink } from 'vue-router';
import ConnectionBadge from '@/features/highlevel/ConnectionBadge.vue';
import UserMenu from './UserMenu.vue';
</script>

<template>
  <header class="sticky top-0 z-30 border-b bg-background">
    <div class="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
      <RouterLink :to="{ name: 'dashboard' }" class="text-sm font-semibold tracking-tight">
        Genesis
      </RouterLink>
      <div class="ml-auto flex items-center gap-2">
        <ConnectionBadge />
        <UserMenu />
      </div>
    </div>
  </header>
</template>
```

- [ ] **Step 3: Verify end to end** (after BE-3): Connect → HighLevel's location chooser → back on `/dashboard?hl=connected` → toast "Connected to <location>", badge "Connected · <location>", query removed from the URL. Deny on HighLevel → toast "Connection was cancelled." Disconnect → confirm dialog → badge "Not connected". Locally without OAuth, seed a connection with `npm --prefix functions run seed:pit` (BE-3.8).

- [ ] **Step 4: Run** `npm test` → PASS. **Commit** — `feat(frontend): add HighLevel connection status, connect and disconnect`

---

### Task FE-2.3: Projects repository and composable (R-BE1–R-BE3)

**Files:**
- Create: `frontend/src/services/firestore/projects.repo.ts`, `frontend/src/features/projects/project-form.schema.ts`, `frontend/src/features/projects/useProjects.ts`
- Test: `frontend/tests/features/projects/project-form.schema.test.ts`

**Interfaces:** Produces `activeProjectsQuery(uid)`, `createProject(uid, input, locationId)`, `updateProject(uid, projectId, input)`, `softDeleteProject(uid, projectId)`, `ProjectInput`; `ProjectFormSchema`, `ProjectFormValues`; `useProjects() → { projects, loading, error, retry, create, rename, remove }`.

- [ ] **Step 1: Failing test**

`frontend/tests/features/projects/project-form.schema.test.ts`:
```ts
import { ProjectFormSchema } from '@/features/projects/project-form.schema';

describe('ProjectFormSchema', () => {
  it('trims and enforces the rules limits', () => {
    expect(ProjectFormSchema.parse({ name: '  Clinic  ', description: '' })).toEqual({
      name: 'Clinic',
      description: '',
    });
    expect(ProjectFormSchema.safeParse({ name: '   ', description: '' }).success).toBe(false);
    expect(ProjectFormSchema.safeParse({ name: 'x'.repeat(61), description: '' }).success).toBe(
      false,
    );
    expect(ProjectFormSchema.safeParse({ name: 'x', description: 'y'.repeat(281) }).success).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Implement** — the writes contain exactly the keys `validProjectCreate` / `validProjectEdit` / `validSoftDelete` allow, with `serverTimestamp()` so `== request.time` holds.

`frontend/src/services/firestore/projects.repo.ts`:
```ts
import {
  addDoc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Query,
} from 'firebase/firestore';
import { refs } from './paths';
import type { Project } from './types';

export interface ProjectInput {
  name: string;
  description: string;
}

/** Dashboard query; backed by the `status ASC, updatedAt DESC` composite index. */
export const activeProjectsQuery = (uid: string): Query<Project> =>
  query(
    refs.projects(uid),
    where('status', '==', 'active'),
    orderBy('updatedAt', 'desc'),
    limit(50),
  );

/** Exactly the fields the rules accept on create (BE-2.1 validProjectCreate). */
export async function createProject(
  uid: string,
  input: ProjectInput,
  locationId: string | null,
): Promise<string> {
  const ref = await addDoc(refs.projectsRaw(uid), {
    name: input.name,
    description: input.description,
    locationId,
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    deletedAt: null,
  });
  return ref.id;
}

export async function updateProject(
  uid: string,
  projectId: string,
  input: ProjectInput,
): Promise<void> {
  await updateDoc(refs.projectRaw(uid, projectId), {
    name: input.name,
    description: input.description,
    updatedAt: serverTimestamp(),
  });
}

export async function softDeleteProject(uid: string, projectId: string): Promise<void> {
  await updateDoc(refs.projectRaw(uid, projectId), {
    status: 'deleted',
    deletedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
```

`frontend/src/features/projects/project-form.schema.ts`:
```ts
import { z } from 'zod';
import { LIMITS } from '@/contracts/limits';

/** Mirrors the rules' validProjectText (BE-2.1). */
export const ProjectFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required.')
    .max(LIMITS.projectNameMax, `Use at most ${LIMITS.projectNameMax} characters.`),
  description: z
    .string()
    .trim()
    .max(LIMITS.projectDescriptionMax, `Use at most ${LIMITS.projectDescriptionMax} characters.`),
});

export type ProjectFormValues = z.output<typeof ProjectFormSchema>;
```

`frontend/src/features/projects/useProjects.ts`:
```ts
import type { ShallowRef, Ref } from 'vue';
import type { FirestoreError } from 'firebase/firestore';
import { useAuth } from '@/composables/useAuth';
import { useFirestoreQuery } from '@/composables/useFirestoreQuery';
import {
  activeProjectsQuery,
  createProject,
  softDeleteProject,
  updateProject,
  type ProjectInput,
} from '@/services/firestore/projects.repo';
import type { Project } from '@/services/firestore/types';
import { useHighLevelConnection } from '@/features/highlevel/useHighLevelConnection';

export interface ProjectsApi {
  projects: ShallowRef<Project[]>;
  loading: Ref<boolean>;
  error: ShallowRef<FirestoreError | null>;
  retry: () => void;
  create: (input: ProjectInput) => Promise<string>;
  rename: (projectId: string, input: ProjectInput) => Promise<void>;
  remove: (projectId: string) => Promise<void>;
}

export function useProjects(): ProjectsApi {
  const { uid } = useAuth();
  const { locationId } = useHighLevelConnection();
  const { data, loading, error, retry } = useFirestoreQuery(() =>
    uid.value ? activeProjectsQuery(uid.value) : null,
  );

  function requireUid(): string {
    if (!uid.value) throw new Error('Not signed in');
    return uid.value;
  }

  return {
    projects: data,
    loading,
    error,
    retry,
    // New projects bind to the connected location (or none); the rules enforce the same.
    create: (input) => createProject(requireUid(), input, locationId.value),
    rename: (projectId, input) => updateProject(requireUid(), projectId, input),
    remove: (projectId) => softDeleteProject(requireUid(), projectId),
  };
}
```

- [ ] **Step 3: Run** `npm test` → PASS. The rules themselves are proven by BE-2.3. **Commit** — `feat(frontend): add projects repository and composable`

---

### Task FE-2.4: Dashboard page and project dialogs

**Files:**
- Create: `frontend/src/features/projects/DashboardPage.vue`, `ProjectCard.vue`, `ProjectFormDialog.vue`, `DeleteProjectDialog.vue`

**Interfaces:** Consumes FE-2.1–FE-2.3. `ProjectFormDialog` (`v-model:open`, `project: Project | null`, `submit(values)`) is reused for renaming in the workspace header (FE-3.1).

- [ ] **Step 1: Implement**

`frontend/src/features/projects/ProjectFormDialog.vue`:
```vue
<script setup lang="ts">
import { computed, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { LIMITS } from '@/contracts/limits';
import { useZodForm } from '@/composables/useZodForm';
import type { Project } from '@/services/firestore/types';
import { ProjectFormSchema, type ProjectFormValues } from './project-form.schema';

const props = defineProps<{
  /** null = create a new project */
  project: Project | null;
  submit: (values: ProjectFormValues) => Promise<void>;
}>();
const open = defineModel<boolean>('open', { required: true });

const isEdit = computed(() => props.project !== null);
const { values, errors, submitting, formError, handleSubmit, reset } = useZodForm(
  ProjectFormSchema,
  { name: '', description: '' },
);

watch(open, (isOpen) => {
  if (isOpen)
    reset({ name: props.project?.name ?? '', description: props.project?.description ?? '' });
});

const onSubmit = handleSubmit(async (data) => {
  await props.submit(data);
  open.value = false;
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Edit project' : 'New project' }}</DialogTitle>
        <DialogDescription>
          {{
            isEdit
              ? 'Rename the project or change its description.'
              : 'Name the app you want to build. You can describe it in chat next.'
          }}
        </DialogDescription>
      </DialogHeader>
      <form novalidate class="grid gap-6" @submit="onSubmit">
        <FieldGroup>
          <Alert v-if="formError" variant="destructive">
            <AlertDescription>{{ formError }}</AlertDescription>
          </Alert>
          <Field :data-invalid="!!errors.name">
            <FieldLabel for="project-name">Name</FieldLabel>
            <Input
              id="project-name"
              v-model="values.name"
              :maxlength="LIMITS.projectNameMax"
              placeholder="Clinic front desk"
              :aria-invalid="!!errors.name"
            />
            <FieldError v-if="errors.name">{{ errors.name }}</FieldError>
          </Field>
          <Field :data-invalid="!!errors.description">
            <FieldLabel for="project-description">Description (optional)</FieldLabel>
            <Textarea
              id="project-description"
              v-model="values.description"
              rows="3"
              :maxlength="LIMITS.projectDescriptionMax"
              :aria-invalid="!!errors.description"
            />
            <FieldDescription>
              {{ values.description.length }}/{{ LIMITS.projectDescriptionMax }}
            </FieldDescription>
            <FieldError v-if="errors.description">{{ errors.description }}</FieldError>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="ghost" @click="open = false">Cancel</Button>
          <Button type="submit" :disabled="submitting">
            <Spinner v-if="submitting" />
            {{ isEdit ? 'Save' : 'Create project' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
```

`frontend/src/features/projects/DeleteProjectDialog.vue`:
```vue
<script setup lang="ts">
import { ref } from 'vue';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { Project } from '@/services/firestore/types';

const props = defineProps<{ project: Project | null; confirm: () => Promise<void> }>();
const open = defineModel<boolean>('open', { required: true });
const busy = ref(false);

async function onConfirm(): Promise<void> {
  busy.value = true;
  try {
    await props.confirm();
    open.value = false;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete “{{ props.project?.name }}”?</AlertDialogTitle>
        <AlertDialogDescription>
          It will be removed from your projects. Files and snapshots are kept in storage but no
          longer shown.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="busy">Cancel</AlertDialogCancel>
        <Button variant="destructive" :disabled="busy" @click="onConfirm">
          <Spinner v-if="busy" />
          Delete project
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
```

`frontend/src/features/projects/ProjectCard.vue`:
```vue
<script setup lang="ts">
import { EllipsisIcon, PencilIcon, Trash2Icon, TriangleAlertIcon } from '@lucide/vue';
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import RelativeTime from '@/components/common/RelativeTime.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toMillis } from '@/lib/time';
import type { Project } from '@/services/firestore/types';

const props = defineProps<{ project: Project; connectedLocationId: string | null }>();
const emit = defineEmits<{ edit: []; delete: [] }>();

const locationMismatch = computed(
  () =>
    props.project.locationId !== null &&
    props.connectedLocationId !== null &&
    props.project.locationId !== props.connectedLocationId,
);
const fileCount = computed(() => props.project.fileCount ?? 0);
</script>

<template>
  <Card class="relative gap-4 transition-colors hover:bg-muted/40">
    <CardHeader>
      <CardTitle class="truncate">
        <RouterLink
          :to="{ name: 'workspace', params: { projectId: props.project.id } }"
          class="after:absolute after:inset-0 focus-visible:outline-none"
        >
          {{ props.project.name }}
        </RouterLink>
      </CardTitle>
      <CardDescription class="line-clamp-2 min-h-10">
        {{ props.project.description || 'No description' }}
      </CardDescription>
      <CardAction class="relative z-10">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="`Actions for ${props.project.name}`"
            >
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem @select="emit('edit')"><PencilIcon />Rename</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" @select="emit('delete')">
              <Trash2Icon />Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardAction>
    </CardHeader>
    <CardFooter class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>Updated <RelativeTime :ms="toMillis(props.project.updatedAt)" /></span>
      <span>{{ fileCount }} {{ fileCount === 1 ? 'file' : 'files' }}</span>
      <Badge v-if="locationMismatch" variant="outline" class="relative z-10 gap-1 text-warning">
        <TriangleAlertIcon class="size-3" />Different location
      </Badge>
    </CardFooter>
  </Card>
</template>
```

`frontend/src/features/projects/DashboardPage.vue`:
```vue
<script setup lang="ts">
import { PlusIcon } from '@lucide/vue';
import { FirebaseError } from 'firebase/app';
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { toast } from 'vue-sonner';
import PageState from '@/components/common/PageState.vue';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import ConnectionCard from '@/features/highlevel/ConnectionCard.vue';
import { useHighLevelConnection } from '@/features/highlevel/useHighLevelConnection';
import { useOAuthReturnToast } from '@/features/highlevel/useOAuthReturnToast';
import { toUserMessage } from '@/lib/errors';
import type { Project } from '@/services/firestore/types';
import DeleteProjectDialog from './DeleteProjectDialog.vue';
import ProjectCard from './ProjectCard.vue';
import ProjectFormDialog from './ProjectFormDialog.vue';
import type { ProjectFormValues } from './project-form.schema';
import { useProjects } from './useProjects';

const router = useRouter();
const { projects, loading, error, retry, create, rename, remove } = useProjects();
const { locationId } = useHighLevelConnection();
useOAuthReturnToast();

const formOpen = ref(false);
const editing = ref<Project | null>(null);
const deleteOpen = ref(false);
const deleting = ref<Project | null>(null);

function openCreate(): void {
  editing.value = null;
  formOpen.value = true;
}
function openEdit(project: Project): void {
  editing.value = project;
  formOpen.value = true;
}
function openDelete(project: Project): void {
  deleting.value = project;
  deleteOpen.value = true;
}

async function submitForm(values: ProjectFormValues): Promise<void> {
  if (editing.value) {
    await rename(editing.value.id, values);
    toast.success('Project updated');
    return;
  }
  const id = await create(values);
  toast.success('Project created');
  await router.push({ name: 'workspace', params: { projectId: id } });
}

async function confirmDelete(): Promise<void> {
  const project = deleting.value;
  if (!project) return;
  try {
    await remove(project.id);
    toast.success(`Deleted “${project.name}”`);
  } catch (e) {
    const generating =
      e instanceof FirebaseError && e.code === 'permission-denied' && project.activeGeneration;
    toast.error(
      generating
        ? 'This project is generating right now. Try again when it finishes.'
        : toUserMessage(e),
    );
    throw e;
  }
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <div class="flex items-center justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Projects</h1>
        <p class="text-sm text-muted-foreground">Apps you've built for your HighLevel account.</p>
      </div>
      <Button @click="openCreate"><PlusIcon />New project</Button>
    </div>

    <ConnectionCard />

    <section aria-label="Projects" class="flex flex-col">
      <div v-if="loading" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton v-for="n in 3" :key="n" class="h-36 rounded-xl" />
      </div>
      <PageState
        v-else-if="error"
        kind="error"
        title="Couldn't load projects"
        :description="toUserMessage(error)"
        action-label="Retry"
        @action="retry"
      />
      <PageState
        v-else-if="projects.length === 0"
        kind="empty"
        title="No projects yet"
        description="Create a project, then describe the app you want in chat."
        action-label="Create project"
        @action="openCreate"
      />
      <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ProjectCard
          v-for="project in projects"
          :key="project.id"
          :project="project"
          :connected-location-id="locationId"
          @edit="openEdit(project)"
          @delete="openDelete(project)"
        />
      </div>
    </section>

    <ProjectFormDialog v-model:open="formOpen" :project="editing" :submit="submitForm" />
    <DeleteProjectDialog v-model:open="deleteOpen" :project="deleting" :confirm="confirmDelete" />
  </div>
</template>
```

- [ ] **Step 2: Verify** (emulators): first run shows the empty state with "Create project"; creating navigates to the workspace; rename and delete update the grid live; the loading state shows three skeleton cards; stop the Firestore emulator → "Couldn't load projects" + Retry; a project created while connected to another location shows "Different location".

- [ ] **Step 3: Commit** — `feat(frontend): add projects dashboard with create, rename and delete`
