import { refDebounced } from '@vueuse/core';
import { computed, onBeforeUnmount, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from 'vue';
import type { PreviewContext } from '@/contracts/bridge';
import { newNonce } from '@/lib/ids';
import { invokeRuntime } from '@/services/api/hl-runtime.api';
import { compilePreview, type CompiledPreview, type PreviewFile } from './compile-preview';
import { PreviewHostBridge, type BridgeCall, type BridgeLog } from './host-bridge';
import runtimeSource from './runtime/genesis-runtime.js?raw';

const MAX_LOGS = 500;
const MAX_CALLS = 200;

/**
 * Compiles a file list into a sandboxed preview and owns one bridge.
 * The workspace preview and each variants option use this; nothing here is workspace-specific.
 */
export function useSandboxPreview(options: {
  files: Ref<readonly PreviewFile[]>;
  projectId: string;
  context: () => PreviewContext;
  /** When set, rebuilds follow this key instead of file contents (the workspace uses content hashes). */
  revision?: Ref<string>;
  debounceMs?: number;
  onPort?: () => void;
}): {
  compiled: ComputedRef<CompiledPreview>;
  nonce: Ref<string>;
  rebuilding: ComputedRef<boolean>;
  logs: ShallowRef<BridgeLog[]>;
  calls: ShallowRef<BridgeCall[]>;
  errorCount: ComputedRef<number>;
  frameElement: ShallowRef<HTMLIFrameElement | null>;
  bridge: PreviewHostBridge;
  reload: () => void;
  clearConsole: () => void;
} {
  const logs = shallowRef<BridgeLog[]>([]);
  const calls = shallowRef<BridgeCall[]>([]);
  const errorCount = computed(() => logs.value.filter((entry) => entry.level === 'error').length);
  const frameElement = shallowRef<HTMLIFrameElement | null>(null);
  const bridge = new PreviewHostBridge({
    getContext: options.context,
    invoke: (method, params, signal) => invokeRuntime(options.projectId, method, params, signal),
    onLog: (entry) => {
      logs.value = [...logs.value, entry].slice(-MAX_LOGS);
    },
    onCall: (call) => {
      calls.value = [...calls.value, call].slice(-MAX_CALLS);
    },
    onPort: () => options.onPort?.(),
  });

  const contentKey = computed(() =>
    options.files.value
      .map((file) => `${file.path}:${file.content.length}:${file.content}`)
      .sort()
      .join('|'),
  );
  const revision = options.revision ?? contentKey;
  const settled = refDebounced(revision, options.debounceMs ?? 0);
  const reloadNonce = ref(0);
  const nonce = ref(newNonce());
  const rebuilding = computed(() => settled.value !== revision.value);

  watch([settled, reloadNonce], () => {
    nonce.value = newNonce();
  });

  const compiled = computed(() =>
    compilePreview({ files: options.files.value, runtimeSource, nonce: nonce.value }),
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

  return {
    compiled,
    nonce,
    rebuilding,
    logs,
    calls,
    errorCount,
    frameElement,
    bridge,
    reload: () => {
      reloadNonce.value += 1;
    },
    clearConsole: () => {
      logs.value = [];
      calls.value = [];
    },
  };
}
