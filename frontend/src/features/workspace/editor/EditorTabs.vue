<script setup lang="ts">
import { XIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const props = defineProps<{
  paths: string[];
  active: string | null;
  dirty: readonly string[];
}>();
const emit = defineEmits<{ select: [path: string]; close: [path: string] }>();

const name = (path: string): string => path.split("/").pop() ?? path;

function onSelect(value: unknown): void {
  if (typeof value === "string") emit("select", value);
}
</script>

<template>
  <Tabs
    v-if="props.paths.length"
    :model-value="props.active ?? undefined"
    class="border-b"
    @update:model-value="onSelect"
  >
    <TabsList
      class="h-9 w-full justify-start gap-0 overflow-x-auto rounded-none bg-transparent p-0"
    >
      <div
        v-for="path in props.paths"
        :key="path"
        class="group flex h-full items-center border-r data-[active=true]:bg-background"
        :data-active="path === props.active"
        @auxclick.prevent="$event.button === 1 && emit('close', path)"
      >
        <TabsTrigger
          :value="path"
          class="h-full rounded-none border-0 px-3 font-mono text-xs shadow-none"
          :title="path"
        >
          {{ name(path) }}
          <span
            v-if="props.dirty.includes(path)"
            class="size-1.5 rounded-full bg-foreground"
            aria-label="Unsaved changes"
          />
        </TabsTrigger>
        <Button
          variant="ghost"
          size="icon-xs"
          class="mr-1 opacity-60 group-hover:opacity-100"
          :aria-label="`Close ${path}`"
          @click="emit('close', path)"
        >
          <XIcon />
        </Button>
      </div>
    </TabsList>
  </Tabs>
</template>
