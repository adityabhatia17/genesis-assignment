# FE-7 — Snapshot history and restore (R-FE7, R-BE8, R-C6)

> Read [`00-overview.md`](00-overview.md) first. Spec: [`../06-frontend-system-design.md`](../06-frontend-system-design.md) §14; flows: [`../07-end-to-end-system-design.md`](../07-end-to-end-system-design.md) §4.10; endpoint A13.

UI copy uses "snapshot" — the assignment's word — everywhere.

---

### Task FE-7.1: Snapshot history sheet

**Files:**

- Create: `frontend/src/services/firestore/snapshots.repo.ts`, `frontend/src/features/snapshots/useSnapshots.ts`, `SnapshotItem.vue`, `SnapshotHistorySheet.vue`

**Interfaces:** Produces `snapshotsQuery(uid, projectId)` (50 newest by `seq`), `fetchSnapshot`, `fetchBlobContent`; `useSnapshots(uid, projectId, enabled)` (listens only while the sheet is open); `<SnapshotItem :snapshot :current :dirty-since-current :restore-disabled @restore>`.

- [ ] **Step 1: Implement**

`frontend/src/services/firestore/snapshots.repo.ts`:

```ts
import { getDoc, limit, orderBy, query, type Query } from 'firebase/firestore';
import { refs } from './paths';
import type { Snapshot } from './types';

export const SNAPSHOT_WINDOW = 50;

export const snapshotsQuery = (uid: string, projectId: string): Query<Snapshot> =>
  query(refs.snapshots(uid, projectId), orderBy('seq', 'desc'), limit(SNAPSHOT_WINDOW));

export async function fetchSnapshot(
  uid: string,
  projectId: string,
  snapshotId: string,
): Promise<Snapshot | null> {
  const snap = await getDoc(refs.snapshot(uid, projectId, snapshotId));
  return snap.exists() ? snap.data() : null;
}

/** Blobs are immutable (content-addressed), so callers may cache them forever. */
export async function fetchBlobContent(
  uid: string,
  projectId: string,
  blobId: string,
): Promise<string | null> {
  const snap = await getDoc(refs.blob(uid, projectId, blobId));
  return snap.exists() ? snap.data().content : null;
}
```

`frontend/src/features/snapshots/useSnapshots.ts`:

```ts
import type { Ref } from 'vue';
import { useFirestoreQuery, type FirestoreQueryState } from '@/composables/useFirestoreQuery';
import { snapshotsQuery } from '@/services/firestore/snapshots.repo';
import type { Snapshot } from '@/services/firestore/types';

/** Listens only while `enabled` (the sheet is open) to keep reads low. */
export function useSnapshots(
  uid: string,
  projectId: string,
  enabled: Ref<boolean>,
): FirestoreQueryState<Snapshot> {
  return useFirestoreQuery(() => (enabled.value ? snapshotsQuery(uid, projectId) : null));
}
```

`frontend/src/features/snapshots/SnapshotItem.vue`:

```vue
<script setup lang="ts">
import { RotateCcwIcon } from '@lucide/vue';
import { computed } from 'vue';
import RelativeTime from '@/components/common/RelativeTime.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toMillis } from '@/lib/time';
import type { Snapshot } from '@/services/firestore/types';

const props = defineProps<{
  snapshot: Snapshot;
  current: boolean;
  dirtySinceCurrent: boolean;
  restoreDisabled: boolean;
}>();
const emit = defineEmits<{ restore: [] }>();

const KIND_LABEL = {
  generation: 'AI',
  checkpoint: 'Checkpoint',
  restore: 'Restore',
} as const;
const changed = computed(
  () => props.snapshot.changedPaths.length + props.snapshot.deletedPaths.length,
);
</script>

<template>
  <li class="flex flex-col gap-1.5 border-b px-4 py-3" data-testid="snapshot-item">
    <div class="flex items-center gap-2">
      <span class="font-mono text-sm font-medium">#{{ props.snapshot.seq }}</span>
      <Badge variant="outline" class="text-[10px]">{{ KIND_LABEL[props.snapshot.kind] }}</Badge>
      <Badge v-if="props.current" variant="secondary" class="text-[10px]">Current</Badge>
      <span class="ml-auto text-xs text-muted-foreground"
        ><RelativeTime :ms="toMillis(props.snapshot.createdAt)"
      /></span>
    </div>
    <p class="line-clamp-2 text-sm">{{ props.snapshot.label }}</p>
    <p class="text-xs text-muted-foreground">
      {{ changed }} {{ changed === 1 ? 'file' : 'files' }} changed ·
      {{ props.snapshot.fileCount }} total
      <template v-if="props.current && props.dirtySinceCurrent">
        · unsaved edits since this snapshot</template
      >
    </p>
    <div class="flex gap-2">
      <Button
        size="xs"
        variant="outline"
        :disabled="props.restoreDisabled"
        @click="emit('restore')"
      >
        <RotateCcwIcon />Restore
      </Button>
    </div>
  </li>
</template>
```

`frontend/src/features/snapshots/SnapshotHistorySheet.vue`:

```vue
<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import PageState from '@/components/common/PageState.vue';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { isActive } from '@/features/workspace/stores/generation.reducer';
import { useGenerationStore } from '@/features/workspace/stores/generation.store';
import { useWorkspaceStore } from '@/features/workspace/stores/workspace.store';
import { useWorkspace } from '@/features/workspace/workspace-context';
import { toUserMessage } from '@/lib/errors';
import type { Snapshot } from '@/services/firestore/types';
import RestoreSnapshotDialog from './RestoreSnapshotDialog.vue';
import SnapshotItem from './SnapshotItem.vue';
import { useSnapshots } from './useSnapshots';

const ws = useWorkspace();
const { historyOpen } = storeToRefs(useWorkspaceStore());
const { state } = storeToRefs(useGenerationStore());
const { data: snapshots, loading, error, retry } = useSnapshots(ws.uid, ws.projectId, historyOpen);

const generating = computed(() => isActive(state.value.status));
const currentId = computed(() => ws.project.value?.latestSnapshotId ?? null);
const dirty = computed(() => ws.project.value?.workingTreeDirty === true);

const restoreOpen = ref(false);
const target = ref<Snapshot | null>(null);

function askRestore(snapshot: Snapshot): void {
  target.value = snapshot;
  restoreOpen.value = true;
}
</script>

<template>
  <Sheet v-model:open="historyOpen">
    <SheetContent side="right" class="flex w-full flex-col gap-0 p-0 sm:max-w-md">
      <SheetHeader class="border-b">
        <SheetTitle>Snapshots</SheetTitle>
        <SheetDescription
          >Every generation saves a snapshot. Restore any version; nothing is
          lost.</SheetDescription
        >
      </SheetHeader>
      <ScrollArea class="min-h-0 flex-1">
        <div v-if="loading" class="flex flex-col gap-3 p-4">
          <Skeleton v-for="n in 4" :key="n" class="h-20" />
        </div>
        <PageState
          v-else-if="error"
          kind="error"
          title="Couldn't load snapshots"
          :description="toUserMessage(error)"
          action-label="Retry"
          @action="retry"
        />
        <PageState
          v-else-if="!snapshots.length"
          kind="empty"
          title="No snapshots yet"
          description="Generate to create the first one."
        />
        <ul v-else>
          <SnapshotItem
            v-for="snapshot in snapshots"
            :key="snapshot.id"
            :snapshot="snapshot"
            :current="snapshot.id === currentId"
            :dirty-since-current="dirty"
            :restore-disabled="generating || (snapshot.id === currentId && !dirty)"
            @restore="askRestore(snapshot)"
          />
        </ul>
      </ScrollArea>
    </SheetContent>
  </Sheet>
  <RestoreSnapshotDialog
    v-model:open="restoreOpen"
    :project-id="ws.projectId"
    :snapshot="target"
    @restored="historyOpen = false"
  />
</template>
```

- [ ] **Step 2: Verify** — "Snapshots" button (or Cmd/Ctrl+Shift+H) opens the sheet: `#seq`, kind (AI / Checkpoint / Restore), label, relative time with the exact time on hover, files changed, "Current"; Restore is disabled while generating and for the current snapshot when nothing changed since. **Commit** — `feat(frontend): add snapshot history sheet`

---

### Task FE-7.2: Restore

**Files:**

- Create: `frontend/src/services/api/snapshots.api.ts`, `frontend/src/features/snapshots/RestoreSnapshotDialog.vue`

**Interfaces:** Produces `restoreSnapshot(projectId, snapshotId) → RestoreResult`.

- [ ] **Step 1: Implement**

`frontend/src/services/api/snapshots.api.ts`:

```ts
import type { RestoreResult } from '@/contracts/api';
import { apiFetch } from '@/lib/http';

export function restoreSnapshot(projectId: string, snapshotId: string): Promise<RestoreResult> {
  return apiFetch(
    'api',
    `/v1/projects/${encodeURIComponent(projectId)}/snapshots/${encodeURIComponent(snapshotId)}/restore`,
    { method: 'POST', body: {} },
  );
}
```

`frontend/src/features/snapshots/RestoreSnapshotDialog.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { toast } from 'vue-sonner';
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
import { toUserMessage } from '@/lib/errors';
import { restoreSnapshot } from '@/services/api/snapshots.api';
import type { Snapshot } from '@/services/firestore/types';

const props = defineProps<{ projectId: string; snapshot: Snapshot | null }>();
const emit = defineEmits<{ restored: [] }>();
const open = defineModel<boolean>('open', { required: true });
const busy = ref(false);

async function onRestore(): Promise<void> {
  if (!props.snapshot) return;
  busy.value = true;
  try {
    const result = await restoreSnapshot(props.projectId, props.snapshot.id);
    toast.success(`Restored #${props.snapshot.seq} (now #${result.snapshotSeq})`);
    open.value = false;
    emit('restored');
  } catch (error) {
    toast.error(toUserMessage(error));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Restore snapshot #{{ props.snapshot?.seq }}?</AlertDialogTitle>
        <AlertDialogDescription>
          Your files return to this version. If you have saved edits since the last snapshot, they
          are kept as a checkpoint first — nothing is lost, and you can restore any version later.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="busy">Cancel</AlertDialogCancel>
        <Button :disabled="busy" @click="onRestore"><Spinner v-if="busy" />Restore</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
```

- [ ] **Step 2: Verify** — generate twice, edit + save, restore #1 → toast "Restored #1 (now #4)", a checkpoint (#3) protects the saved edit, the editor models update from the listener, the preview rebuilds, and the chat shows the system note "Restored snapshot #1 · Snapshot #4". **Commit** — `feat(frontend): restore snapshots`

---

### Task FE-7.3: Diff view (bonus R-B3)

Implemented (R-B3): `snapshot-diff.ts` and `SnapshotDiffDialog.vue`, opened from View changes. History + restore (FE-7.1 / FE-7.2) remain.
