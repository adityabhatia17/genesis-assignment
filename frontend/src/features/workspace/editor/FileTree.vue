<script setup lang="ts">
import { computed } from "vue";
import { ScrollArea } from "@/components/ui/scroll-area";
import { buildFileTree } from "./file-tree";
import FileTreeNode, { type NodeMarks } from "./FileTreeNode.vue";

const props = defineProps<{ paths: string[]; marks: NodeMarks }>();
const emit = defineEmits<{ open: [path: string] }>();
const tree = computed(() => buildFileTree(props.paths));
</script>

<template>
  <ScrollArea class="h-full">
    <p
      class="px-3 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
    >
      Files
    </p>
    <p v-if="tree.length === 0" class="px-3 py-2 text-xs text-muted-foreground">
      No files yet
    </p>
    <ul v-else role="tree" aria-label="Project files" class="px-1 pb-3">
      <FileTreeNode
        v-for="node in tree"
        :key="node.path"
        :node="node"
        :depth="0"
        :marks="props.marks"
        @open="emit('open', $event)"
      />
    </ul>
  </ScrollArea>
</template>
