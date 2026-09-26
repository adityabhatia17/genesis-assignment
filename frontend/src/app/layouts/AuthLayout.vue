<script setup lang="ts">
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
      <p class="mb-8 text-center text-sm font-semibold tracking-tight">Genesis</p>
      <slot />
    </div>
  </div>
</template>
