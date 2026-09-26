<script setup lang="ts">
import { PlugIcon, UnplugIcon } from '@lucide/vue';
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { confirmAction } from '@/composables/useConfirm';
import { useHighLevelConnection } from './useHighLevelConnection';

const { status, locationName, timezone, connecting, disconnecting, connect, disconnect } =
  useHighLevelConnection();

const description = computed(() => {
  switch (status.value) {
    case 'connected':
      return 'Generated apps read and write this sub-account through Genesis.';
    case 'reauth_required':
      return 'The connection expired. Reconnect to keep live data in your previews.';
    default:
      return 'Connect a sub-account so previews show your real contacts, conversations and appointments.';
  }
});

async function onDisconnect(): Promise<void> {
  const ok = await confirmAction({
    title: 'Disconnect HighLevel?',
    description: 'Previews stop loading live data until you connect again. Your projects are kept.',
    confirmLabel: 'Disconnect',
    destructive: true,
  });
  if (ok) await disconnect();
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>HighLevel</CardTitle>
      <CardDescription>{{ description }}</CardDescription>
      <CardAction v-if="status !== 'loading'">
        <Button
          v-if="status !== 'connected'"
          size="sm"
          :disabled="connecting"
          @click="connect('/dashboard')"
        >
          <Spinner v-if="connecting" />
          <PlugIcon v-else />
          {{ status === 'reauth_required' ? 'Reconnect' : 'Connect HighLevel' }}
        </Button>
        <Button v-else variant="ghost" size="sm" :disabled="disconnecting" @click="onDisconnect">
          <Spinner v-if="disconnecting" />
          <UnplugIcon v-else />
          Disconnect
        </Button>
      </CardAction>
    </CardHeader>
    <CardContent>
      <Skeleton v-if="status === 'loading'" class="h-4 w-48" />
      <dl
        v-else-if="status !== 'disconnected'"
        class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
      >
        <dt class="text-muted-foreground">Location</dt>
        <dd class="truncate font-medium">{{ locationName ?? '—' }}</dd>
        <dt class="text-muted-foreground">Timezone</dt>
        <dd>{{ timezone ?? '—' }}</dd>
      </dl>
      <p v-else class="text-sm text-muted-foreground">Not connected</p>
    </CardContent>
  </Card>
</template>
