<script setup lang="ts">
import { RouterLink } from 'vue-router';
import ConnectionBadge from '@/features/highlevel/ConnectionBadge.vue';
import UserMenu from './UserMenu.vue';
</script>

<template>
  <header class="sticky top-0 z-30 border-b bg-background">
    <div class="mx-auto flex h-[52px] w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
      <RouterLink :to="{ name: 'dashboard' }" class="text-sm font-semibold tracking-tight">
        Genesis
      </RouterLink>
      <div class="ml-auto flex items-center gap-2">
        <ConnectionBadge />
        <UserMenu />
      </div>
    </div>
  </header>
</template>
