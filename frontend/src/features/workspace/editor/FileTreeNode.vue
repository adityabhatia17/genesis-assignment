<script setup lang="ts">
import {
  ChevronRightIcon,
  FileCodeIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
} from "@lucide/vue";
import { ref } from "vue";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { TreeNode } from "./file-tree";

export interface NodeMarks {
  active: string | null;
  dirty: readonly string[];
  streaming: string | null;
  uncommitted: readonly string[];
}

const props = defineProps<{
  node: TreeNode;
  depth: number;
  marks: NodeMarks;
}>();
const emit = defineEmits<{ open: [path: string] }>();
const expanded = ref(true);
</script>

<template>
  <li
    role="treeitem"
    :aria-expanded="props.node.kind === 'folder' ? expanded : undefined"
  >
    <button
      type="button"
      :class="
        cn(
          'flex w-full items-center gap-1.5 rounded-sm py-1 pr-2 text-left text-[13px] hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
          props.marks.active === props.node.path && 'bg-muted font-medium',
        )
      "
      :style="{ paddingLeft: `${8 + props.depth * 12}px` }"
      @click="
        props.node.kind === 'folder'
          ? (expanded = !expanded)
          : emit('open', props.node.path)
      "
    >
      <template v-if="props.node.kind === 'folder'">
        <ChevronRightIcon
          :class="[
            'size-3.5 shrink-0 text-muted-foreground',
            expanded && 'rotate-90',
          ]"
        />
        <FolderOpenIcon
          v-if="expanded"
          class="size-4 shrink-0 text-muted-foreground"
        />
        <FolderIcon v-else class="size-4 shrink-0 text-muted-foreground" />
      </template>
      <template v-else>
        <span class="w-3.5 shrink-0" />
        <FileCodeIcon
          v-if="/\.(js|css|html)$/.test(props.node.name)"
          class="size-4 shrink-0 text-muted-foreground"
        />
        <FileIcon v-else class="size-4 shrink-0 text-muted-foreground" />
      </template>
      <span
        class="truncate font-mono text-xs"
        :class="props.marks.uncommitted.includes(props.node.path) && 'italic'"
      >
        {{ props.node.name }}
      </span>
      <Spinner
        v-if="props.marks.streaming === props.node.path"
        class="ml-auto size-3"
      />
      <span
        v-else-if="props.marks.dirty.includes(props.node.path)"
        class="ml-auto size-1.5 rounded-full bg-foreground"
        aria-label="Unsaved changes"
      />
    </button>
    <ul v-if="props.node.kind === 'folder' && expanded" role="group">
      <FileTreeNode
        v-for="child in props.node.children"
        :key="child.path"
        :node="child"
        :depth="props.depth + 1"
        :marks="props.marks"
        @open="emit('open', $event)"
      />
    </ul>
  </li>
</template>
