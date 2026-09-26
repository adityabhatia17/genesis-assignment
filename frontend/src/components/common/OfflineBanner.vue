<script setup lang="ts">
import { WifiOffIcon } from '@lucide/vue';
import { useOnline } from '@vueuse/core';

const online = useOnline();
</script>

<template>
  <div
    v-if="!online"
    role="status"
    class="flex items-center justify-center gap-2 border-b bg-muted px-4 py-1.5 text-xs text-muted-foreground"
  >
    <WifiOffIcon class="size-3.5" aria-hidden="true" />
    You're offline. Saving and generating are paused until the connection returns.
  </div>
</template>
