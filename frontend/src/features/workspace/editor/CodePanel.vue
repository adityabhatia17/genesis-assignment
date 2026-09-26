<script setup lang="ts">
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, watch } from "vue";
import PageState from "@/components/common/PageState.vue";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { confirmAction } from "@/composables/useConfirm";
import { useTheme } from "@/composables/useTheme";
import { useFileSave } from "../composables/useFileSave";
import { isActive } from "../stores/generation.reducer";
import { useGenerationStore } from "../stores/generation.store";
import { useWorkspaceStore } from "../stores/workspace.store";
import { useWorkspace } from "../workspace-context";
import CodeEditor from "./CodeEditor.vue";
import EditorStatusBar from "./EditorStatusBar.vue";
import EditorTabs from "./EditorTabs.vue";
import FileTree from "./FileTree.vue";
import SaveConflictDialog from "./SaveConflictDialog.vue";

const ws = useWorkspace();
const workspace = useWorkspaceStore();
const {
  openPaths,
  activePath,
  dirtyPaths,
  conflictPaths,
  savingPath,
  treeCollapsed,
  followGeneration,
} = storeToRefs(workspace);
const { state } = storeToRefs(useGenerationStore());
const { resolved } = useTheme();
const saver = useFileSave();

const readOnly = computed(() => isActive(state.value.status));
const committed = computed(
  () => new Map(ws.files.value.map((f) => [f.path, f])),
);
const uncommitted = computed(() =>
  Object.values(state.value.files)
    .filter(
      (f) =>
        f.op === "write" &&
        f.status !== "rejected" &&
        !committed.value.has(f.path),
    )
    .map((f) => f.path),
);
const treePaths = computed(() => [
  ...committed.value.keys(),
  ...uncommitted.value,
]);
const activeFile = computed(() =>
  activePath.value ? (committed.value.get(activePath.value) ?? null) : null,
);
const hasModel = computed(
  () =>
    activePath.value !== null &&
    (activeFile.value !== null || uncommitted.value.includes(activePath.value)),
);
const marks = computed(() => ({
  active: activePath.value,
  dirty: dirtyPaths.value,
  streaming: state.value.streamingPath,
  uncommitted: uncommitted.value,
}));

// Models are created lazily, before the editor switches to them (pre-flush watcher).
watch(
  activeFile,
  (file) => {
    if (file) ws.models.ensure(file);
  },
  { immediate: true },
);

async function closeTab(path: string): Promise<void> {
  if (dirtyPaths.value.includes(path)) {
    const ok = await confirmAction({
      title: `Discard unsaved changes to ${path}?`,
      confirmLabel: "Discard changes",
      destructive: true,
    });
    if (!ok) return;
    ws.models.discardChanges(path);
  }
  workspace.closeFile(path);
}

function useLatest(path: string): void {
  saver.useTheirs(path);
}
function keepMine(path: string): void {
  void saver.keepMine(
    path,
    ws.models.conflictOf(path)?.version ?? ws.models.baseVersion(path),
  );
}
</script>

<template>
  <section class="flex h-full min-h-0" aria-label="Code">
    <aside v-if="!treeCollapsed" class="w-52 shrink-0 border-r">
      <FileTree
        :paths="treePaths"
        :marks="marks"
        @open="workspace.openFile($event)"
      />
    </aside>
    <div class="flex min-w-0 flex-1 flex-col">
      <div class="flex items-center">
        <Button
          variant="ghost"
          size="icon-sm"
          class="mx-1 shrink-0"
          :aria-label="treeCollapsed ? 'Show files' : 'Hide files'"
          @click="treeCollapsed = !treeCollapsed"
        >
          <PanelLeftOpenIcon v-if="treeCollapsed" />
          <PanelLeftCloseIcon v-else />
        </Button>
        <EditorTabs
          class="min-w-0 flex-1"
          :paths="openPaths"
          :active="activePath"
          :dirty="dirtyPaths"
          @select="workspace.openFile($event)"
          @close="closeTab"
        />
        <label
          v-if="readOnly"
          class="flex shrink-0 items-center gap-1.5 px-3 text-xs text-muted-foreground"
        >
          <Switch
            v-model="followGeneration"
            aria-label="Follow the file being written"
          />
          Follow
        </label>
      </div>
      <Alert
        v-if="activePath && conflictPaths.includes(activePath)"
        class="m-2 w-auto"
      >
        <AlertDescription class="flex flex-wrap items-center gap-2">
          This file changed elsewhere while you were editing.
          <Button size="xs" variant="outline" @click="useLatest(activePath)"
            >Use the latest</Button
          >
          <Button size="xs" @click="keepMine(activePath)">Keep mine</Button>
        </AlertDescription>
      </Alert>
      <div class="relative min-h-0 flex-1">
        <CodeEditor
          v-if="activePath && hasModel"
          :path="activePath"
          :read-only="readOnly"
          :follow="followGeneration"
          :theme="resolved"
          @save="saver.save(activePath)"
        />
        <PageState
          v-else
          kind="empty"
          :title="ws.files.value.length ? 'Select a file' : 'No files yet'"
          :description="
            ws.files.value.length
              ? 'Choose a file in the tree to view or edit it.'
              : 'Files appear here as Genesis writes them.'
          "
        />
      </div>
      <EditorStatusBar
        :file="activeFile"
        :dirty="activePath !== null && dirtyPaths.includes(activePath)"
        :read-only="readOnly"
        :saving="savingPath !== null"
      />
    </div>
    <SaveConflictDialog />
  </section>
</template>
