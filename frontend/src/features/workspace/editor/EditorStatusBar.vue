<script setup lang="ts">
import type { ProjectFile } from "@/services/firestore/types";

const props = defineProps<{
  file: ProjectFile | null;
  dirty: boolean;
  readOnly: boolean;
  saving: boolean;
}>();

const size = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
</script>

<template>
  <div
    class="flex h-7 items-center gap-3 border-t px-3 text-[11px] text-muted-foreground"
    role="status"
  >
    <template v-if="props.file">
      <span class="capitalize">{{ props.file.language }}</span>
      <span>{{ size(props.file.sizeBytes) }}</span>
      <span>v{{ props.file.version }}</span>
    </template>
    <span v-if="props.saving">Saving…</span>
    <span v-else-if="props.dirty">Unsaved changes</span>
    <span v-if="props.readOnly" class="ml-auto"
      >Read-only while Genesis is generating</span
    >
  </div>
</template>
