<script setup lang="ts">
import { computed } from "vue";
import { Spinner } from "@/components/ui/spinner";
import { phaseLabel } from "../stores/generation.labels";
import type { GenerationState } from "../stores/generation.reducer";
import FileOpChips from "./FileOpChips.vue";
import ThinkingDisclosure from "./ThinkingDisclosure.vue";

const props = defineProps<{ state: GenerationState }>();
const emit = defineEmits<{ "open-file": [path: string] }>();

const label = computed(() => phaseLabel(props.state));
const files = computed(() =>
  props.state.fileOrder.flatMap((p) => props.state.files[p] ?? []),
);
const streaming = computed(() => props.state.status === "streaming");
</script>

<template>
  <div class="px-1" data-testid="live-message">
    <p class="mb-1 text-[11px] font-medium text-muted-foreground">Genesis</p>
    <p
      v-if="label"
      class="mb-2 flex items-center gap-2 text-xs text-muted-foreground"
    >
      <Spinner class="size-3.5" />{{ label }}
    </p>
    <ThinkingDisclosure
      v-if="props.state.thinking"
      :text="props.state.thinking"
      class="mb-2"
    />
    <p v-if="props.state.prose" class="text-sm whitespace-pre-wrap">
      {{ props.state.prose
      }}<span
        v-if="streaming"
        class="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-foreground/60 motion-safe:animate-pulse"
        aria-hidden="true"
      />
    </p>
    <FileOpChips
      v-if="files.length"
      :files="files"
      class="mt-2"
      @open="emit('open-file', $event)"
    />
  </div>
</template>
