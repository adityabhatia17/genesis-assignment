<script setup lang="ts">
const props = defineProps<{ keys: string[] }>();
</script>

<template>
  <span class="inline-flex items-center gap-0.5">
    <kbd
      v-for="key in props.keys"
      :key="key"
      class="inline-flex min-w-4 items-center justify-center rounded-[3px] border border-border px-1 font-mono text-2xs font-medium text-muted-foreground"
    >
      {{ key }}
    </kbd>
  </span>
</template>
