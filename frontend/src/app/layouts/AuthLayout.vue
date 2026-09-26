<script setup lang="ts">
import GenesisMark from '@/components/common/GenesisMark.vue';
import ThemeToggle from '@/components/common/ThemeToggle.vue';
</script>

<template>
  <div
    class="relative flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12"
  >
    <div class="absolute top-4 right-4">
      <ThemeToggle />
    </div>
    <div class="w-full max-w-sm">
      <div class="mb-8 flex items-center justify-center gap-2.5">
        <GenesisMark />
        <p class="text-base font-semibold tracking-tight">Genesis</p>
      </div>
      <slot />
    </div>
  </div>
</template>
