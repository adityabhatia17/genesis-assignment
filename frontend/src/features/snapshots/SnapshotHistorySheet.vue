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
import SnapshotDiffDialog from './SnapshotDiffDialog.vue';
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
const diffOpen = ref(false);
const target = ref<Snapshot | null>(null);

function askRestore(snapshot: Snapshot): void {
  target.value = snapshot;
  restoreOpen.value = true;
}

function viewChanges(snapshot: Snapshot): void {
  target.value = snapshot;
  diffOpen.value = true;
}
</script>

<template>
  <Sheet v-model:open="historyOpen">
    <SheetContent side="right" class="flex w-full flex-col gap-0 p-0 sm:max-w-md">
      <SheetHeader class="border-b">
        <SheetTitle>History</SheetTitle>
        <SheetDescription>
          Every generation is saved here. Restore any version. Nothing is lost.
        </SheetDescription>
      </SheetHeader>
      <ScrollArea class="min-h-0 flex-1">
        <div v-if="loading" class="flex flex-col gap-3 p-4">
          <Skeleton v-for="n in 4" :key="n" class="h-20" />
        </div>
        <PageState
          v-else-if="error"
          kind="error"
          title="Couldn't load history"
          :description="toUserMessage(error)"
          action-label="Retry"
          @action="retry"
        />
        <PageState
          v-else-if="!snapshots.length"
          kind="empty"
          title="No history yet"
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
            @view="viewChanges(snapshot)"
          />
        </ul>
      </ScrollArea>
    </SheetContent>
  </Sheet>
  <SnapshotDiffDialog v-model:open="diffOpen" :snapshot="target" />
  <RestoreSnapshotDialog
    v-model:open="restoreOpen"
    :project-id="ws.projectId"
    :snapshot="target"
    @restored="historyOpen = false"
  />
</template>
