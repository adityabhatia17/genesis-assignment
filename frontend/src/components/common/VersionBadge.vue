<script setup lang="ts">
const props = defineProps<{
  n: number;
  current?: boolean;
}>();
</script>

<template>
  <span class="inline-flex items-center gap-1.5">
    <span class="rounded-sm border border-input px-1 font-mono text-2xs font-medium"
      >v{{ props.n }}</span
    >
    <span v-if="props.current" class="rounded-sm bg-primary-soft px-1.5 py-0.5 text-xs text-primary"
      >Current</span
    >
  </span>
</template>
