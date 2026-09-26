<script setup lang="ts">
import { EllipsisIcon, PencilIcon, Trash2Icon, TriangleAlertIcon } from '@lucide/vue';
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import RelativeTime from '@/components/common/RelativeTime.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toMillis } from '@/lib/time';
import type { Project } from '@/services/firestore/types';

const props = defineProps<{ project: Project; connectedLocationId: string | null }>();
const emit = defineEmits<{ edit: []; delete: [] }>();

const locationMismatch = computed(
  () =>
    props.project.locationId !== null &&
    props.connectedLocationId !== null &&
    props.project.locationId !== props.connectedLocationId,
);
const fileCount = computed(() => props.project.fileCount ?? 0);
</script>

<template>
  <div
    class="relative grid grid-cols-[minmax(0,1fr)_90px_130px_40px] items-center gap-x-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
  >
    <div class="min-w-0">
      <RouterLink
        :to="{ name: 'workspace', params: { projectId: props.project.id } }"
        class="block truncate text-sm font-medium after:absolute after:inset-0 focus-visible:outline-none"
      >
        {{ props.project.name }}
      </RouterLink>
      <p v-if="props.project.description" class="truncate text-xs text-muted-foreground">
        {{ props.project.description }}
      </p>
      <Badge
        v-if="locationMismatch"
        variant="outline"
        class="relative z-10 mt-1 gap-1 text-warning"
      >
        <TriangleAlertIcon class="size-3" />Different location
      </Badge>
    </div>
    <span class="text-right text-xs text-muted-foreground">
      {{ fileCount }} {{ fileCount === 1 ? 'file' : 'files' }}
    </span>
    <span class="text-right text-xs text-muted-foreground">
      <RelativeTime :ms="toMillis(props.project.updatedAt)" />
    </span>
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          size="icon-sm"
          class="relative z-10"
          :aria-label="`Actions for ${props.project.name}`"
        >
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem @select="emit('edit')"><PencilIcon />Rename</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" @select="emit('delete')">
          <Trash2Icon />Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
