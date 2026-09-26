<script setup lang="ts">
import { ChevronRightIcon } from "@lucide/vue";
import { ref } from "vue";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const props = defineProps<{ text: string }>();
const open = ref(false);
</script>

<template>
  <Collapsible v-model:open="open" class="rounded-md border bg-muted/30">
    <CollapsibleTrigger
      class="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground"
    >
      <ChevronRightIcon
        :class="[
          'size-3.5 transition-transform motion-reduce:transition-none',
          open && 'rotate-90',
        ]"
      />
      Planning
    </CollapsibleTrigger>
    <CollapsibleContent>
      <p
        class="max-h-48 overflow-y-auto px-3 pb-2.5 text-xs whitespace-pre-wrap text-muted-foreground"
      >
        {{ props.text }}
      </p>
    </CollapsibleContent>
  </Collapsible>
</template>
