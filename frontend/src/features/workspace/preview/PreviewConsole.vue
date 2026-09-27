<script setup lang="ts">
import { EraserIcon, XIcon } from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { BridgeCall, BridgeLog } from './host-bridge';

const props = defineProps<{ logs: BridgeLog[]; calls: BridgeCall[] }>();
const emit = defineEmits<{ clear: []; close: [] }>();
const time = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour12: false });
</script>

<template>
  <Tabs default-value="console" class="flex h-56 flex-col gap-0 border-t">
    <div class="flex items-center border-b px-2">
      <TabsList class="h-8 bg-transparent">
        <TabsTrigger value="console" class="text-xs">Console</TabsTrigger>
        <TabsTrigger value="calls" class="text-xs">HighLevel calls</TabsTrigger>
      </TabsList>
      <div class="ml-auto flex items-center">
        <Button variant="ghost" size="icon-xs" aria-label="Clear" @click="emit('clear')">
          <EraserIcon />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Close console" @click="emit('close')">
          <XIcon />
        </Button>
      </div>
    </div>
    <TabsContent value="console" class="min-h-0 flex-1">
      <ScrollArea class="h-full">
        <p v-if="!props.logs.length" class="p-3 text-xs text-muted-foreground">
          No console output yet.
        </p>
        <pre
          v-for="(log, i) in props.logs"
          :key="i"
          :class="
            cn('border-b px-3 py-1 font-mono text-[11px] whitespace-pre-wrap', {
              'text-destructive': log.level === 'error',
              'text-warning': log.level === 'warn',
            })
          "
        ><span class="text-muted-foreground">{{ time(log.at) }} </span>{{ log.text }}</pre>
      </ScrollArea>
    </TabsContent>
    <TabsContent value="calls" class="min-h-0 flex-1">
      <ScrollArea class="h-full">
        <p v-if="!props.calls.length" class="p-3 text-xs text-muted-foreground">
          No HighLevel calls yet.
        </p>
        <div
          v-for="call in props.calls"
          :key="call.id + call.at"
          class="flex items-center gap-3 border-b px-3 py-1 font-mono text-[11px]"
        >
          <span class="text-muted-foreground">{{ time(call.at) }}</span>
          <span class="truncate">{{ call.method }}</span>
          <span class="ml-auto tabular-nums text-muted-foreground">{{ call.ms }} ms</span>
          <Badge :variant="call.ok ? 'outline' : 'destructive'" class="text-[10px]">{{
            call.ok ? 'ok' : call.code
          }}</Badge>
        </div>
      </ScrollArea>
    </TabsContent>
  </Tabs>
</template>
