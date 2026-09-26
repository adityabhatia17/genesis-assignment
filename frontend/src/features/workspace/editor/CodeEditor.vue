<script setup lang="ts">
import { VueMonacoEditor } from '@guolao/vue-monaco-editor';
import type * as Monaco from 'monaco-editor';
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue';
import { Spinner } from '@/components/ui/spinner';
import { useWorkspace } from '../workspace-context';
import { setupMonaco } from './monaco-setup';

const props = defineProps<{
  path: string;
  readOnly: boolean;
  follow: boolean;
  theme: 'light' | 'dark';
}>();
const emit = defineEmits<{ save: [] }>();

const monaco = setupMonaco();
const { models } = useWorkspace();
const editor = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
let contentListener: Monaco.IDisposable | null = null;

const options = computed<Monaco.editor.IStandaloneEditorConstructionOptions>(() => ({
  readOnly: props.readOnly,
  readOnlyMessage: { value: 'Read-only while Genesis is generating.' },
  minimap: { enabled: false },
  fontSize: 13,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  tabSize: 2,
  wordWrap: 'on',
  scrollBeyondLastLine: false,
  automaticLayout: true,
  formatOnPaste: false,
  formatOnType: false,
}));

function attach(path: string, previous: string | null): void {
  const instance = editor.value;
  if (!instance) return;
  if (previous) models.saveViewState(previous, instance.saveViewState());
  const model = models.get(path);
  instance.setModel(model);
  const state = models.viewState(path);
  if (model && state) instance.restoreViewState(state);
  contentListener?.dispose();
  // "Follow generation": keep the last streamed line in view.
  contentListener =
    model?.onDidChangeContent(() => {
      if (props.readOnly && props.follow) instance.revealLine(model.getLineCount());
    }) ?? null;
}

function onMount(instance: Monaco.editor.IStandaloneCodeEditor): void {
  const placeholder = instance.getModel();
  editor.value = instance;
  instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => emit('save'));
  attach(props.path, null);
  placeholder?.dispose(); // the wrapper's own empty model
}

watch(
  () => props.path,
  (next, previous) => attach(next, previous),
);

onBeforeUnmount(() => {
  const instance = editor.value;
  if (!instance) return;
  models.saveViewState(props.path, instance.saveViewState());
  contentListener?.dispose();
  // The wrapper disposes whatever model is attached on unmount; ours must survive.
  instance.setModel(null);
});
</script>

<template>
  <VueMonacoEditor
    :theme="props.theme === 'dark' ? 'genesis-dark' : 'genesis-light'"
    :options="options"
    @mount="onMount"
  >
    <div class="flex h-full items-center justify-center">
      <Spinner class="text-muted-foreground" />
    </div>
  </VueMonacoEditor>
</template>
