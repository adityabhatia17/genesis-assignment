<script setup lang="ts">
import { PlugIcon } from '@lucide/vue';
import { refDebounced } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import PageState from '@/components/common/PageState.vue';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { PreviewContext } from '@/contracts/bridge';
import { useHighLevelConnection } from '@/features/highlevel/useHighLevelConnection';
import { newNonce } from '@/lib/ids';
import { invokeRuntime } from '@/services/api/hl-runtime.api';
import { usePreviewEvents } from '../composables/usePreviewEvents';
import { useWorkspaceStore } from '../stores/workspace.store';
import { useWorkspace } from '../workspace-context';
import { compilePreview } from './compile-preview';
import { PreviewHostBridge, type BridgeCall, type BridgeLog } from './host-bridge';
import PreviewConsole from './PreviewConsole.vue';
import PreviewFrame from './PreviewFrame.vue';
import PreviewToolbar from './PreviewToolbar.vue';
import runtimeSource from './runtime/genesis-runtime.js?raw';

const MAX_LOGS = 500;
const MAX_CALLS = 200;

const ws = useWorkspace();
const workspace = useWorkspaceStore();
const { previewNonce, consoleOpen } = storeToRefs(workspace);
const hl = useHighLevelConnection();

const logs = shallowRef<BridgeLog[]>([]);
const calls = shallowRef<BridgeCall[]>([]);
const errorCount = computed(() => logs.value.filter((l) => l.level === 'error').length);
const frameElement = shallowRef<HTMLIFrameElement | null>(null);

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

let flushEvents = (): void => undefined;
const bridge = new PreviewHostBridge({
  getContext: context,
  invoke: (method, params, signal) => invokeRuntime(ws.projectId, method, params, signal),
  onLog: (entry) => (logs.value = [...logs.value, entry].slice(-MAX_LOGS)),
  onCall: (call) => (calls.value = [...calls.value, call].slice(-MAX_CALLS)),
  onPort: () => flushEvents(),
});
flushEvents = usePreviewEvents(bridge);

// Only committed files feed the preview: it rebuilds after a generation commit, a save or a
// restore — never while tokens stream or from unsaved buffers (R-FE5).
const fingerprint = computed(() =>
  ws.files.value
    .map((f) => `${f.path}:${f.contentHash}`)
    .sort()
    .join('|'),
);
const settled = refDebounced(fingerprint, 150);
const nonce = ref(newNonce());
const rebuilding = computed(() => settled.value !== fingerprint.value);

watch([settled, previewNonce], () => {
  nonce.value = newNonce();
});

const compiled = computed(() =>
  compilePreview({ files: ws.files.value, runtimeSource, nonce: nonce.value }),
);

watch(
  nonce,
  (value) => {
    logs.value = [];
    bridge.attach(() => frameElement.value, value);
  },
  { immediate: true },
);
onBeforeUnmount(() => bridge.detach());

const snapshotSeq = computed(() => ws.project.value?.snapshotSeq ?? 0);
const label = computed(() => {
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
  <section class="flex h-full min-h-0 flex-col" aria-label="Preview">
    <PreviewToolbar
      :label="label"
      :error-count="errorCount"
      :console-open="consoleOpen"
      @reload="workspace.reloadPreview()"
      @toggle-console="consoleOpen = !consoleOpen"
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
    <div class="relative min-h-0 flex-1 bg-muted/30">
      <PreviewFrame
        v-if="compiled.html"
        :key="nonce"
        :html="compiled.html"
        @ready="frameElement = $event"
        @navigated="onNavigated"
      />
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
      @clear="
        logs = [];
        calls = [];
      "
    />
  </section>
</template>
