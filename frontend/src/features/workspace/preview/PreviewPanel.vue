<script setup lang="ts">
import { PlugIcon } from '@lucide/vue';
import { useEventListener, useMediaQuery } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import PageState from '@/components/common/PageState.vue';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { PreviewContext } from '@/contracts/bridge';
import OptionToggle from '@/features/variants/OptionToggle.vue';
import { useVariantsStore } from '@/features/variants/stores/variants.store';
import { useHighLevelConnection } from '@/features/highlevel/useHighLevelConnection';
import { usePreviewEvents } from '../composables/usePreviewEvents';
import { useGenerationStore } from '../stores/generation.store';
import { useWorkspaceStore } from '../stores/workspace.store';
import { useWorkspace } from '../workspace-context';
import type { PreviewFile } from './compile-preview';
import PreviewConsole from './PreviewConsole.vue';
import PreviewFrame from './PreviewFrame.vue';
import PreviewToolbar from './PreviewToolbar.vue';
import { useSandboxPreview } from './useSandboxPreview';

const ws = useWorkspace();
const workspace = useWorkspaceStore();
const generation = useGenerationStore();
const variants = useVariantsStore();
const { previewNonce, consoleOpen } = storeToRefs(workspace);
const { state: generationState } = storeToRefs(generation);
const { options, selectedId, pendingId, selecting, confirmation } = storeToRefs(variants);
const hl = useHighLevelConnection();
const wide = useMediaQuery('(min-width: 1024px)');

const expanded = ref(false);

function context(): PreviewContext {
  const project = ws.project.value;
  const linked = hl.status.value === 'connected' && hl.locationId.value !== null;
  return {
    location: linked
      ? {
          id: hl.locationId.value ?? '',
          name: hl.locationName.value ?? '',
          timezone: hl.timezone.value,
        }
      : null,
    project: { id: ws.projectId, name: project?.name ?? '' },
    hlStatus: hl.status.value === 'loading' ? 'disconnected' : hl.status.value,
  };
}

const choosing = computed(
  () =>
    generationState.value.mode === 'variants' &&
    generationState.value.status === 'awaiting_selection',
);
const buildingOptions = computed(
  () =>
    generationState.value.mode === 'variants' &&
    ['submitting', 'streaming', 'reconciling', 'cancelling'].includes(generationState.value.status),
);
const selected = computed(
  () => options.value.find((option) => option.entry.candidateId === selectedId.value) ?? null,
);
const previewFiles = computed((): PreviewFile[] => {
  if (choosing.value) return selected.value?.files ?? [];
  const seq = ws.project.value?.snapshotSeq ?? 0;
  if (confirmation.value?.files && seq === 0) return confirmation.value.files;
  return ws.files.value;
});
const fingerprint = computed(() =>
  previewFiles.value
    .map((file) => {
      const hash =
        'contentHash' in file ? String((file as { contentHash?: string }).contentHash ?? '') : '';
      return `${file.path}:${hash || file.content.length}`;
    })
    .sort()
    .join('|'),
);
let relay = (): void => undefined;
const preview = useSandboxPreview({
  files: previewFiles,
  projectId: ws.projectId,
  context,
  revision: fingerprint,
  debounceMs: 150,
  onPort: () => relay(),
});
relay = usePreviewEvents(preview.bridge);
const { compiled, nonce, rebuilding, logs, calls, errorCount, frameElement } = preview;

watch(previewNonce, () => preview.reload());

const snapshotSeq = computed(() => ws.project.value?.snapshotSeq ?? 0);
const label = computed(() => {
  if (choosing.value && selected.value) {
    return `Option ${selected.value.entry.rank} of ${options.value.length} · preview only`;
  }
  if (buildingOptions.value) return 'Building your options';
  if (rebuilding.value) return 'Rebuilding…';
  if (!compiled.value.html) return 'Waiting for the first generation';
  const edits = ws.project.value?.workingTreeDirty ? ' + saved edits' : '';
  return snapshotSeq.value > 0 ? `Live · history #${snapshotSeq.value}${edits}` : `Live${edits}`;
});
const mismatch = computed(() => {
  const projectLocation = ws.project.value?.locationId ?? null;
  return (
    projectLocation !== null &&
    hl.locationId.value !== null &&
    projectLocation !== hl.locationId.value
  );
});

const toggleOptions = computed(() =>
  options.value.map((option) => ({
    candidateId: option.entry.candidateId,
    rank: option.entry.rank,
    total: option.entry.total,
    topPick: option.entry.topPick,
  })),
);
const toggleLocked = computed(() => pendingId.value !== null || selecting.value !== null);

function toggleExpanded(): void {
  if (!expanded.value && !compiled.value.html) return;
  expanded.value = !expanded.value;
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape' && expanded.value) expanded.value = false;
});

function onNavigated(): void {
  logs.value = [
    ...logs.value,
    {
      level: 'warn',
      text: 'The app navigated away from itself; the preview was reloaded.',
      at: Date.now(),
    },
  ];
  workspace.reloadPreview();
}
</script>

<template>
  <section
    class="flex min-h-0 flex-col bg-background"
    :class="expanded ? 'fixed inset-0 z-50 h-dvh' : 'h-full'"
    aria-label="Preview"
  >
    <PreviewToolbar
      :label="label"
      :error-count="errorCount"
      :console-open="consoleOpen"
      :expanded="expanded"
      :can-expand="Boolean(compiled.html)"
      @reload="workspace.reloadPreview()"
      @toggle-console="consoleOpen = !consoleOpen"
      @toggle-expand="toggleExpanded"
    />
    <Alert
      v-if="hl.status.value !== 'connected' && hl.status.value !== 'loading' && compiled.html"
      class="m-2 w-auto"
    >
      <PlugIcon />
      <AlertTitle>HighLevel isn't connected</AlertTitle>
      <AlertDescription class="flex flex-wrap items-center gap-2">
        The app runs, but its data calls fail until you connect.
        <Button size="xs" variant="outline" @click="hl.connect(`/projects/${ws.projectId}`)"
          >Connect</Button
        >
      </AlertDescription>
    </Alert>
    <Alert v-else-if="mismatch" class="m-2 w-auto">
      <AlertTitle>This project belongs to another HighLevel location</AlertTitle>
      <AlertDescription
        >Data calls return an error until you reconnect that location.</AlertDescription
      >
    </Alert>
    <Alert v-if="compiled.issues.length && compiled.html" class="m-2 w-auto">
      <AlertTitle>Preview build notes</AlertTitle>
      <AlertDescription>
        <ul class="list-disc pl-4">
          <li v-for="issue in compiled.issues" :key="issue.message">{{ issue.message }}</li>
        </ul>
      </AlertDescription>
    </Alert>
    <OptionToggle
      v-if="!wide && choosing && toggleOptions.length > 0"
      class="m-2"
      :options="toggleOptions"
      :selected-id="selectedId"
      :locked="toggleLocked"
      @select="variants.choose"
    />
    <div class="relative min-h-0 flex-1 bg-muted/30">
      <PreviewFrame
        v-if="compiled.html"
        :key="nonce"
        :html="compiled.html"
        @ready="frameElement = $event"
        @navigated="onNavigated"
      />
      <PageState
        v-else-if="buildingOptions"
        kind="empty"
        title="Building your options"
        description="They will show here when they are ready."
      />
      <PageState
        v-else-if="choosing && selected?.state === 'error'"
        kind="error"
        title="Couldn't load this version"
        action-label="Retry"
        @action="selected && variants.retryOption(selected.entry.candidateId)"
      />
      <PageState v-else-if="choosing" kind="loading" title="Loading this version" />
      <PageState
        v-else-if="!ws.filesLoading.value"
        kind="empty"
        title="Your app will appear here"
        description="Describe what you want in the chat. The preview runs it on your HighLevel data."
      />
      <PageState v-else kind="loading" title="Loading files" />
    </div>
    <PreviewConsole
      v-if="consoleOpen"
      :logs="logs"
      :calls="calls"
      @clear="preview.clearConsole()"
      @close="consoleOpen = false"
    />
  </section>
</template>
