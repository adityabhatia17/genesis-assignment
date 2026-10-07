<script setup lang="ts">
import { InfoIcon } from '@lucide/vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { FallbackReason } from '@/features/workspace/stores/generation.reducer';
import { fallbackNotice } from './variants.labels';

const props = defineProps<{ reason: FallbackReason | null }>();
</script>

<template>
  <Alert v-if="fallbackNotice(props.reason)" class="mb-3">
    <InfoIcon />
    <AlertDescription>{{ fallbackNotice(props.reason) }}</AlertDescription>
  </Alert>
</template>
