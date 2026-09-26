<script setup lang="ts">
import { RouterView } from 'vue-router';
import ConfirmDialog from '@/components/common/ConfirmDialog.vue';
import OfflineBanner from '@/components/common/OfflineBanner.vue';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useTheme } from '@/composables/useTheme';
import AppLayout from './layouts/AppLayout.vue';
import AuthLayout from './layouts/AuthLayout.vue';

const { resolved } = useTheme();
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <OfflineBanner />
    <RouterView v-slot="{ Component, route }">
      <AuthLayout v-if="route.meta.layout === 'auth'">
        <component :is="Component" />
      </AuthLayout>
      <AppLayout v-else-if="route.meta.layout === 'app'">
        <component :is="Component" />
      </AppLayout>
      <!-- Keyed by path: switching projects remounts the workspace with fresh state. -->
      <component :is="Component" v-else :key="route.path" />
    </RouterView>
    <ConfirmDialog />
    <Toaster :theme="resolved" position="bottom-right" close-button />
  </TooltipProvider>
</template>
