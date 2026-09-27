<script setup lang="ts">
import { getDoc } from 'firebase/firestore';
import { computed, ref, watch } from 'vue';
import PageState from '@/components/common/PageState.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useWorkspace } from '@/features/workspace/workspace-context';
import { toUserMessage } from '@/lib/errors';
import { refs } from '@/services/firestore/paths';
import type { Snapshot } from '@/services/firestore/types';
import {
  classifyChanges,
  diffLines,
  filesByPath,
  type DiffRow,
  type FileChange,
  type FileChangeKind,
} from './snapshot-diff';

const props = defineProps<{ snapshot: Snapshot | null }>();
const open = defineModel<boolean>('open', { required: true });
const ws = useWorkspace();

const KIND_LABEL: Record<FileChangeKind, string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
};

const compareCurrent = ref(false);
const loading = ref(false);
const error = ref<unknown>(null);
const changes = ref<FileChange[]>([]);
const selectedPath = ref<string | null>(null);
const rows = ref<DiffRow[]>([]);
const rowsLoading = ref(false);
const rowsError = ref<unknown>(null);
let request = 0;

const selected = computed(
  () => changes.value.find((change) => change.path === selectedPath.value) ?? null,
);
const leftLabel = computed(() => (compareCurrent.value ? 'This version' : 'Previous'));
const rightLabel = computed(() => (compareCurrent.value ? 'Current files' : 'This version'));

function cell(text: string | null): string {
  return text === null || text === '' ? '\u00a0' : text;
}

function rowClass(side: 'left' | 'right', kind: DiffRow['kind']): string {
  if (kind === 'same') return '';
  if (side === 'left' && (kind === 'remove' || kind === 'change')) return 'bg-destructive/10';
  if (side === 'right' && (kind === 'add' || kind === 'change')) return 'bg-accent';
  return 'bg-muted/40';
}

async function blobContent(blobId: string | null): Promise<string> {
  if (!blobId) return '';
  const snap = await getDoc(refs.blob(ws.uid, ws.projectId, blobId));
  return snap.exists() ? snap.data().content : '';
}

async function show(token: number, path: string | null, list: FileChange[]): Promise<void> {
  const change = list.find((item) => item.path === path);
  if (!change || !props.snapshot) {
    if (token === request) {
      rows.value = [];
      rowsLoading.value = false;
    }
    return;
  }
  rowsLoading.value = true;
  rowsError.value = null;
  try {
    const left = await blobContent(change.beforeBlobId);
    const right = compareCurrent.value
      ? (ws.files.value.find((file) => file.path === change.path)?.content ?? '')
      : await blobContent(change.afterBlobId);
    if (token !== request) return;
    rows.value = diffLines(left, right);
  } catch (cause) {
    if (token !== request) return;
    rowsError.value = cause;
    rows.value = [];
  } finally {
    if (token === request) rowsLoading.value = false;
  }
}

async function refresh(): Promise<void> {
  const snapshot = props.snapshot;
  if (!snapshot) return;
  const token = ++request;
  loading.value = true;
  error.value = null;
  try {
    const version = filesByPath(snapshot.files);
    let before = new Map<string, { blobId: string }>();
    let after: Map<string, { blobId: string }> = version;
    if (compareCurrent.value) {
      before = version;
      after = new Map(ws.files.value.map((file) => [file.path, { blobId: file.contentHash }]));
    } else if (snapshot.parentSnapshotId) {
      const parent = await getDoc(refs.snapshot(ws.uid, ws.projectId, snapshot.parentSnapshotId));
      if (parent.exists()) before = filesByPath(parent.data().files);
    }
    if (token !== request) return;
    const next = classifyChanges(before, after);
    changes.value = next;
    const path = next.some((change) => change.path === selectedPath.value)
      ? selectedPath.value
      : (next[0]?.path ?? null);
    selectedPath.value = path;
    loading.value = false;
    await show(token, path, next);
  } catch (cause) {
    if (token !== request) return;
    error.value = cause;
    changes.value = [];
    rows.value = [];
    loading.value = false;
  }
}

function select(path: string): void {
  selectedPath.value = path;
  void show(++request, path, changes.value);
}

function toggleCompare(): void {
  compareCurrent.value = !compareCurrent.value;
}

watch(
  () => [open.value, props.snapshot?.id, compareCurrent.value] as const,
  ([isOpen, snapshotId], prev) => {
    if (!isOpen || !snapshotId) return;
    const opened = prev === undefined || !prev[0] || prev[1] !== snapshotId;
    if (opened && compareCurrent.value) {
      compareCurrent.value = false;
      return;
    }
    void refresh();
  },
);
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      v-if="props.snapshot"
      class="flex! h-[min(85vh,820px)] w-[min(96vw,72rem)] max-w-none flex-col gap-3 overflow-hidden sm:max-w-none"
    >
      <DialogHeader>
        <DialogTitle>Changes in #{{ props.snapshot.seq }}</DialogTitle>
        <DialogDescription>
          {{
            compareCurrent
              ? 'This version compared with the files open in the editor.'
              : 'What this version changed from the one before it.'
          }}
        </DialogDescription>
      </DialogHeader>
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs text-muted-foreground">
          {{ changes.length }} {{ changes.length === 1 ? 'file' : 'files' }}
        </p>
        <Button size="xs" variant="outline" @click="toggleCompare">
          {{ compareCurrent ? 'Compare with previous version' : 'Compare with current files' }}
        </Button>
      </div>
      <PageState v-if="loading" kind="loading" title="Loading changes" />
      <PageState
        v-else-if="error"
        kind="error"
        title="Couldn't load changes"
        :description="toUserMessage(error)"
        action-label="Retry"
        @action="refresh"
      />
      <PageState
        v-else-if="!changes.length"
        kind="empty"
        title="No changes"
        :description="
          compareCurrent
            ? 'This version matches the current files.'
            : 'This version matches the one before it.'
        "
      />
      <div v-else class="grid min-h-0 flex-1 grid-cols-[12rem_1fr] gap-3">
        <ScrollArea class="min-h-0 rounded-lg border">
          <ul class="flex flex-col p-1">
            <li v-for="change in changes" :key="change.path">
              <button
                type="button"
                class="flex w-full flex-col items-start gap-1 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                :class="change.path === selectedPath ? 'bg-muted' : ''"
                @click="select(change.path)"
              >
                <span class="w-full truncate font-mono text-xs">{{ change.path }}</span>
                <Badge
                  variant="outline"
                  class="text-[10px]"
                  :class="change.kind === 'deleted' ? 'text-destructive' : ''"
                >
                  {{ KIND_LABEL[change.kind] }}
                </Badge>
              </button>
            </li>
          </ul>
        </ScrollArea>
        <div class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border">
          <div class="grid shrink-0 grid-cols-2 border-b text-xs text-muted-foreground">
            <span class="px-2 py-1.5">{{ leftLabel }}</span>
            <span class="border-l px-2 py-1.5">{{ rightLabel }}</span>
          </div>
          <PageState v-if="rowsLoading" kind="loading" title="Loading file" />
          <PageState
            v-else-if="rowsError"
            kind="error"
            title="Couldn't load this file"
            :description="toUserMessage(rowsError)"
            action-label="Retry"
            @action="selectedPath && select(selectedPath)"
          />
          <div v-else class="min-h-0 min-w-0 flex-1 overflow-auto">
            <div
              v-for="(row, index) in rows"
              :key="index"
              class="grid grid-cols-2 font-mono text-xs leading-5"
            >
              <span
                class="min-w-0 whitespace-pre-wrap break-all px-2"
                :class="rowClass('left', row.kind)"
                >{{ cell(row.left) }}</span
              >
              <span
                class="min-w-0 whitespace-pre-wrap break-all border-l px-2"
                :class="rowClass('right', row.kind)"
                >{{ cell(row.right) }}</span
              >
            </div>
            <p v-if="selected && !rows.length" class="px-2 py-3 text-xs text-muted-foreground">
              Both sides are empty.
            </p>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
