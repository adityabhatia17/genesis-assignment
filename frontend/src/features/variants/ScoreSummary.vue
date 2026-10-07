<script setup lang="ts">
import { GROUP_LABELS, groupPercent, scoreAriaLabel, type ScoreGroups } from './score-display';

const props = defineProps<{ total: number; groups: ScoreGroups }>();
const keys = Object.keys(GROUP_LABELS) as (keyof typeof GROUP_LABELS)[];
</script>

<template>
  <div class="flex flex-col gap-2" :aria-label="scoreAriaLabel(props.total, props.groups)">
    <p class="font-mono text-2xl leading-none text-foreground">
      {{ props.total }}<span class="text-sm text-muted-foreground">/100</span>
    </p>
    <ul class="flex flex-col gap-1.5" aria-hidden="true">
      <li v-for="key in keys" :key="key" class="grid grid-cols-[7.5rem_1fr_auto] items-center gap-2">
        <span class="text-xs text-muted-foreground">{{ GROUP_LABELS[key] }}</span>
        <span class="h-1.5 overflow-hidden rounded-sm bg-muted">
          <span
            class="block h-full bg-primary"
            :style="{ width: `${groupPercent(props.groups[key])}%` }"
          />
        </span>
        <span class="font-mono text-2xs text-muted-foreground"
          >{{ props.groups[key].points }}/{{ props.groups[key].max }}</span
        >
      </li>
    </ul>
  </div>
</template>
