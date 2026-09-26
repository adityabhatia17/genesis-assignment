<script setup lang="ts">
import { RefreshCwIcon, TerminalIcon } from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const props = defineProps<{ label: string; errorCount: number; consoleOpen: boolean }>();
const emit = defineEmits<{ reload: []; 'toggle-console': [] }>();
</script>

<template>
  <div class="flex h-9 items-center gap-2 border-b px-3 text-xs">
    <span class="truncate text-muted-foreground" role="status">{{ props.label }}</span>
    <div class="ml-auto flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Reload preview"
            @click="emit('reload')"
          >
            <RefreshCwIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reload preview</TooltipContent>
      </Tooltip>
      <Button
        variant="ghost"
        size="sm"
        :aria-pressed="props.consoleOpen"
        aria-label="Toggle console"
        @click="emit('toggle-console')"
      >
        <TerminalIcon />Console
        <Badge v-if="props.errorCount" variant="destructive" class="h-4 px-1 tabular-nums">{{
          props.errorCount
        }}</Badge>
      </Button>
    </div>
  </div>
</template>
