<script setup lang="ts">
import { CircleAlertIcon } from '@lucide/vue';
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';

const props = defineProps<{
  kind: 'loading' | 'empty' | 'error';
  title?: string;
  description?: string;
  actionLabel?: string;
  actionTo?: RouteLocationRaw;
}>();

const emit = defineEmits<{ action: [] }>();
</script>

<template>
  <div
    v-if="props.kind === 'loading'"
    class="flex min-h-40 flex-1 items-center justify-center"
    role="status"
    aria-live="polite"
  >
    <Spinner class="size-5 text-muted-foreground" />
    <span class="sr-only">{{ props.title ?? 'Loading' }}</span>
  </div>
  <Empty v-else class="min-h-40 flex-1">
    <EmptyHeader>
      <EmptyMedia v-if="props.kind === 'error'" variant="icon">
        <CircleAlertIcon />
      </EmptyMedia>
      <EmptyTitle>{{ props.title }}</EmptyTitle>
      <EmptyDescription v-if="props.description">{{ props.description }}</EmptyDescription>
    </EmptyHeader>
    <EmptyContent v-if="props.actionLabel">
      <Button v-if="props.actionTo" as-child variant="outline" size="sm">
        <RouterLink :to="props.actionTo">{{ props.actionLabel }}</RouterLink>
      </Button>
      <Button v-else variant="outline" size="sm" @click="emit('action')">
        {{ props.actionLabel }}
      </Button>
    </EmptyContent>
  </Empty>
</template>
