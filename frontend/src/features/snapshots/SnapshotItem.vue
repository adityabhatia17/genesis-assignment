<script setup lang="ts">
import { RotateCcwIcon } from '@lucide/vue';
import { computed } from 'vue';
import RelativeTime from '@/components/common/RelativeTime.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toMillis } from '@/lib/time';
import type { Snapshot } from '@/services/firestore/types';

const props = defineProps<{
  snapshot: Snapshot;
  current: boolean;
  dirtySinceCurrent: boolean;
  restoreDisabled: boolean;
}>();
const emit = defineEmits<{ restore: [] }>();

const KIND_LABEL = {
  generation: 'AI',
  checkpoint: 'Checkpoint',
  restore: 'Restore',
} as const;
const changed = computed(
  () => props.snapshot.changedPaths.length + props.snapshot.deletedPaths.length,
);
</script>

<template>
  <li class="flex flex-col gap-1.5 border-b px-4 py-3" data-testid="snapshot-item">
    <div class="flex items-center gap-2">
      <span class="font-mono text-sm font-medium">#{{ props.snapshot.seq }}</span>
      <Badge variant="outline" class="text-[10px]">{{ KIND_LABEL[props.snapshot.kind] }}</Badge>
      <Badge v-if="props.current" variant="secondary" class="text-[10px]">Current</Badge>
      <span class="ml-auto text-xs text-muted-foreground">
        <RelativeTime :ms="toMillis(props.snapshot.createdAt)" />
      </span>
    </div>
    <p class="line-clamp-2 text-sm">{{ props.snapshot.label }}</p>
    <p class="text-xs text-muted-foreground">
      {{ changed }} {{ changed === 1 ? 'file' : 'files' }} changed · {{ props.snapshot.fileCount }}
      total
      <template v-if="props.current && props.dirtySinceCurrent"> · saved edits since</template>
    </p>
    <div class="flex gap-2">
      <Button
        size="xs"
        variant="outline"
        :disabled="props.restoreDisabled"
        @click="emit('restore')"
      >
        <RotateCcwIcon />Restore
      </Button>
    </div>
  </li>
</template>
