<script setup lang="ts">
import { optionToggleLabel } from './option-label';
import TopPickMarker from './TopPickMarker.vue';

export interface ToggleOption {
  candidateId: string;
  rank: number;
  total: number;
  topPick: boolean;
  /** Present on the ranked entry. The toggle must not render it. */
  directionLabel?: string;
}

const props = defineProps<{
  options: readonly ToggleOption[];
  selectedId: string | null;
  locked: boolean;
}>();

const emit = defineEmits<{ select: [id: string] }>();

function pick(id: string): void {
  if (props.locked || id === props.selectedId) return;
  emit('select', id);
}

function onKeydown(event: KeyboardEvent): void {
  if (props.locked || props.options.length < 2) return;
  const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
  const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
  if (!forward && !back) return;
  event.preventDefault();
  const index = props.options.findIndex((option) => option.candidateId === props.selectedId);
  const step = forward ? 1 : -1;
  const next = props.options[(index + step + props.options.length) % props.options.length];
  if (next) emit('select', next.candidateId);
}
</script>

<template>
  <div
    role="radiogroup"
    aria-label="Versions"
    class="grid gap-1 rounded-lg bg-muted p-1"
    :style="{ gridTemplateColumns: `repeat(${Math.max(props.options.length, 1)}, minmax(0, 1fr))` }"
    @keydown="onKeydown"
  >
    <button
      v-for="option in props.options"
      :key="option.candidateId"
      type="button"
      role="radio"
      class="flex min-w-0 flex-col items-start gap-1 rounded-md px-2 py-1.5 text-left text-xs disabled:opacity-50"
      :class="
        option.candidateId === props.selectedId
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground'
      "
      :aria-checked="option.candidateId === props.selectedId"
      :tabindex="option.candidateId === props.selectedId ? 0 : -1"
      :disabled="props.locked"
      @click="pick(option.candidateId)"
    >
      <span class="font-medium">{{ optionToggleLabel(option.rank, option.total) }}</span>
      <TopPickMarker v-if="option.topPick" />
    </button>
  </div>
</template>
