<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    state: 'active' | 'positive' | 'warning' | 'negative' | 'off';
    size?: 6 | 7;
  }>(),
  { size: 7 },
);

const fill: Record<typeof props.state, string> = {
  active: 'bg-primary shadow-[0_0_0_3px_var(--primary-soft)]',
  positive: 'bg-success',
  warning: 'bg-warning',
  negative: 'bg-destructive',
  off: 'border-[1.5px] border-faint-foreground bg-transparent',
};
</script>

<template>
  <span
    class="inline-block shrink-0 rounded-full"
    :class="fill[props.state]"
    :style="{ width: `${props.size}px`, height: `${props.size}px` }"
    aria-hidden="true"
  />
</template>
