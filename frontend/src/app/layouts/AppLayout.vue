<script setup lang="ts">
import AppHeader from '@/components/common/AppHeader.vue';
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-background">
    <AppHeader />
    <main class="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6">
      <slot />
    </main>
  </div>
</template>
