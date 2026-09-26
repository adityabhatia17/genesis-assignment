<script setup lang="ts">
import type { Component } from 'vue';

const props = defineProps<{
  tone: 'ok' | 'warn' | 'err' | 'neutral';
  icon?: Component;
}>();

const toneClass = {
  ok: 'border-success/30 bg-success-soft text-success',
  warn: 'border-warning/30 bg-warning-soft text-warning',
  err: 'border-destructive/30 bg-destructive-soft text-destructive',
  neutral: 'border-border bg-muted text-muted-foreground',
} as const;
</script>

<template>
  <div
    class="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs"
    :class="toneClass[props.tone]"
    role="status"
  >
    <component :is="props.icon" v-if="props.icon" class="size-3.5 shrink-0" aria-hidden="true" />
    <slot />
  </div>
</template>
