<script setup lang="ts">
import { CheckIcon, Trash2Icon, XIcon } from "@lucide/vue";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FileOpState } from "../stores/generation.reducer";

const props = defineProps<{ files: FileOpState[] }>();
const emit = defineEmits<{ open: [path: string] }>();

const label = (f: FileOpState): string =>
  ({
    streaming: "writing",
    valid: "written",
    rejected: "rejected",
    deleted: "deleted",
  })[f.status];
</script>

<template>
  <ul class="flex flex-wrap gap-1.5" aria-label="Files in this generation">
    <li v-for="file in props.files" :key="file.path">
      <Tooltip :disabled="file.issues.length === 0">
        <TooltipTrigger as-child>
          <button
            type="button"
            class="rounded-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            :aria-label="`${file.path}, ${label(file)}`"
            @click="emit('open', file.path)"
          >
            <Badge
              :variant="file.status === 'rejected' ? 'destructive' : 'outline'"
              class="gap-1 font-mono text-[11px]"
            >
              <Spinner v-if="file.status === 'streaming'" class="size-3" />
              <CheckIcon
                v-else-if="file.status === 'valid'"
                class="size-3 text-success"
              />
              <Trash2Icon
                v-else-if="file.status === 'deleted'"
                class="size-3"
              />
              <XIcon v-else class="size-3" />
              {{ file.path }}
            </Badge>
          </button>
        </TooltipTrigger>
        <TooltipContent class="max-w-72">
          <p v-for="issue in file.issues" :key="issue.code + issue.message">
            {{ issue.message }}
          </p>
        </TooltipContent>
      </Tooltip>
    </li>
  </ul>
</template>
