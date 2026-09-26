<script setup lang="ts">
import { Button } from '@/components/ui/button';

const emit = defineEmits<{ pick: [prompt: string] }>();

const EXAMPLES = [
  'Contact dashboard with search and upcoming appointments',
  'Conversations inbox with a message thread',
  'Upcoming appointments grouped by calendar',
] as const;
</script>

<template>
  <div class="flex flex-col gap-2 px-4 pb-2">
    <p class="text-xs text-muted-foreground">Start from an example</p>
    <div class="flex flex-wrap gap-2">
      <Button
        v-for="example in EXAMPLES"
        :key="example"
        variant="outline"
        size="sm"
        class="h-auto max-w-full py-1.5 text-left whitespace-normal"
        @click="emit('pick', example)"
      >
        {{ example }}
      </Button>
    </div>
  </div>
</template>
