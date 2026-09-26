<script setup lang="ts">
import StatusDot from './StatusDot.vue';

const props = defineProps<{
  label: string;
  tone: 'ok' | 'warn' | 'err' | 'neutral';
}>();

const state = {
  ok: 'positive',
  warn: 'warning',
  err: 'negative',
  neutral: 'off',
} as const;
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-xs text-foreground">
    <StatusDot :state="state[props.tone]" />
    {{ props.label }}
  </span>
</template>
