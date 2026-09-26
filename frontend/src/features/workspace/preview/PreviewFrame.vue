<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { PREVIEW_SANDBOX } from './preview-csp';

const props = defineProps<{ html: string }>();
const emit = defineEmits<{ ready: [element: HTMLIFrameElement]; navigated: [] }>();
const frame = ref<HTMLIFrameElement | null>(null);
let loads = 0;

/**
 * CSP cannot stop a document from navigating its own frame. The first load is our srcdoc;
 * any later load means the app navigated away, so the panel rebuilds it.
 */
function onLoad(): void {
  loads += 1;
  if (loads > 1) emit('navigated');
}

onMounted(() => {
  if (frame.value) emit('ready', frame.value);
});
</script>

<template>
  <iframe
    ref="frame"
    :srcdoc="props.html"
    :sandbox="PREVIEW_SANDBOX"
    referrerpolicy="no-referrer"
    title="App preview"
    class="size-full border-0 bg-white"
    @load="onLoad"
  />
</template>
