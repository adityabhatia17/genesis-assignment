<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useGenerationStore } from '@/features/workspace/stores/generation.store';
import { LONG_WAIT_MS, STAGE_ORDER, stageIndex, stageLabel } from './variants.labels';

const generation = useGenerationStore();
const { state } = storeToRefs(generation);
const now = ref(Date.now());
const timer = setInterval(() => {
  now.value = Date.now();
}, 15_000);
onBeforeUnmount(() => clearInterval(timer));

const phase = computed(() => state.value.variants?.phase ?? null);
const index = computed(() => stageIndex(phase.value));
const longWait = computed(
  () => state.value.startedAt !== null && now.value - state.value.startedAt >= LONG_WAIT_MS,
);
const stopping = computed(() => state.value.status === 'cancelling');
</script>

<template>
  <section class="flex flex-col gap-3" aria-live="polite">
    <div class="flex items-center gap-2 text-sm">
      <Spinner v-if="!stopping" class="size-4" />
      <p class="font-medium">{{ stopping ? 'Stopping…' : stageLabel(phase) }}</p>
    </div>
    <ol class="flex flex-col gap-1">
      <li
        v-for="(step, i) in STAGE_ORDER"
        :key="step"
        class="flex items-center gap-2 text-xs"
        :class="i <= index ? 'text-foreground' : 'text-muted-foreground'"
      >
        <span
          class="size-1.5 rounded-full"
          :class="
            i < index
              ? 'bg-primary'
              : i === index
                ? 'bg-primary ring-2 ring-primary/30'
                : 'bg-muted-foreground/40'
          "
          aria-hidden="true"
        />
        {{ stageLabel(step) }}
      </li>
    </ol>
    <p class="text-xs text-muted-foreground">This usually takes two to three minutes.</p>
    <p v-if="longWait" class="text-sm">This is taking longer than usual.</p>
    <Button
      variant="outline"
      class="self-start"
      :disabled="stopping || state.status === 'submitting'"
      @click="generation.cancel()"
    >
      Stop
    </Button>
  </section>
</template>
