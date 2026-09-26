<script setup lang="ts">
import { useIntervalFn, useNow } from '@vueuse/core';
import { computed } from 'vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatAbsolute, formatRelative } from '@/lib/time';

const props = defineProps<{ ms: number | null }>();

const now = useNow({ scheduler: (tick) => useIntervalFn(tick, 30_000) });
const relative = computed(() =>
  props.ms === null ? '—' : formatRelative(props.ms, now.value.getTime()),
);
const absolute = computed(() => (props.ms === null ? '' : formatAbsolute(props.ms)));
const iso = computed(() => (props.ms === null ? undefined : new Date(props.ms).toISOString()));
</script>

<template>
  <Tooltip v-if="props.ms !== null">
    <TooltipTrigger as-child>
      <time :datetime="iso" class="tabular-nums">{{ relative }}</time>
    </TooltipTrigger>
    <TooltipContent>{{ absolute }}</TooltipContent>
  </Tooltip>
  <span v-else>—</span>
</template>
