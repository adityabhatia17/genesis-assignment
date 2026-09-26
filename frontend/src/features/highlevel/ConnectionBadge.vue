<script setup lang="ts">
import StatusDot from '@/components/common/StatusDot.vue';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/composables/useAuth';
import { useHighLevelConnection } from './useHighLevelConnection';

const { uid } = useAuth();
const { status, locationName, timezone, scopes } = useHighLevelConnection();
</script>

<template>
  <template v-if="uid">
    <Skeleton v-if="status === 'loading'" class="h-5 w-28" />
    <Tooltip v-else-if="status === 'connected'">
      <TooltipTrigger as-child>
        <Badge variant="secondary" class="max-w-60 gap-1.5" data-testid="hl-badge">
          <StatusDot state="positive" />
          <span class="truncate">Connected · {{ locationName ?? 'HighLevel' }}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {{ timezone ?? 'Timezone unknown' }} · {{ scopes.length }} permissions granted
      </TooltipContent>
    </Tooltip>
    <Badge
      v-else-if="status === 'reauth_required'"
      variant="outline"
      class="gap-1.5"
      data-testid="hl-badge"
    >
      <StatusDot state="warning" />
      Reconnect HighLevel
    </Badge>
    <Badge v-else variant="outline" class="gap-1.5" data-testid="hl-badge">
      <StatusDot state="off" />
      Not connected
    </Badge>
  </template>
</template>
