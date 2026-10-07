<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

const props = defineProps<{ total: number; busy: boolean }>();
const emit = defineEmits<{ confirm: []; back: [] }>();
</script>

<template>
  <div
    class="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3"
    role="group"
    aria-label="Check this choice"
  >
    <p class="text-sm">
      Use this version (score {{ props.total }})? The other option will be removed. You can keep
      changing the app in chat afterwards.
    </p>
    <div class="flex flex-wrap gap-2">
      <Button size="sm" :disabled="props.busy" @click="emit('confirm')">
        <Spinner v-if="props.busy" />
        Yes, use this version
      </Button>
      <Button size="sm" variant="outline" :disabled="props.busy" @click="emit('back')"
        >Go back</Button
      >
    </div>
  </div>
</template>
