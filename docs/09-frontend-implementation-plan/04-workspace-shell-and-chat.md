# FE-3 — Workspace shell and chat (R-FE3)

> Read [`00-overview.md`](00-overview.md) first. Spec: [`../06-frontend-system-design.md`](../06-frontend-system-design.md) §9–§10; listeners: [`../07-end-to-end-system-design.md`](../07-end-to-end-system-design.md) §4.5.
>
> The workspace files below are shown in their **final** form. `WorkspacePage.vue` wires composables from FE-4 to FE-8; when executing strictly in order, comment out the `use…()` calls and the `models` field whose modules don't exist yet, and restore them in the task that creates them (each task lists the file under "Modify").

---

### Task FE-3.1: Workspace page, context, layout and store

**Files:**

- Create: `frontend/src/features/workspace/workspace-context.ts`, `stores/workspace.store.ts`, `composables/useProjectFiles.ts`, `WorkspacePage.vue`, `WorkspaceHeader.vue`, `WorkspaceLayout.vue`, `frontend/src/services/firestore/files.repo.ts`
- Test: `frontend/tests/features/workspace/stores/workspace.store.test.ts`

**Interfaces:**

- Produces: `WorkspaceContext { uid; projectId; project: ShallowRef<Project | null>; files: ShallowRef<ProjectFile[]>; filesLoading; models: EditorModels }`, `provideWorkspace(ctx)`, `useWorkspace()`; `useWorkspaceStore()` with `openPaths, activePath, dirtyPaths, conflictPaths, saveConflict, savingPath, previewNonce, consoleOpen, historyOpen, mobileTab, followGeneration, treeCollapsed` and `reset, openFile, closeFile, setDirty, setConflict, retainPaths, reloadPreview`; `filesQuery(uid, projectId)`, `useProjectFiles(uid, projectId)`.

- [ ] **Step 1: Failing test**

`frontend/tests/features/workspace/stores/workspace.store.test.ts`:

```ts
import { createPinia, setActivePinia } from "pinia";
import { useWorkspaceStore } from "@/features/workspace/stores/workspace.store";

describe("workspace store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("opens, activates and closes tabs predictably", () => {
    const ws = useWorkspaceStore();
    ws.reset("p1");
    ws.openFile("index.html");
    ws.openFile("app.js");
    ws.openFile("styles.css", false);
    expect(ws.openPaths).toEqual(["index.html", "app.js", "styles.css"]);
    expect(ws.activePath).toBe("app.js");
    ws.closeFile("app.js");
    expect(ws.activePath).toBe("styles.css");
  });

  it("drops tabs and flags for deleted files", () => {
    const ws = useWorkspaceStore();
    ws.reset("p1");
    ws.openFile("old.js");
    ws.setDirty("old.js", true);
    ws.retainPaths(["index.html"]);
    expect(ws.openPaths).toEqual([]);
    expect(ws.dirtyPaths).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement**

`frontend/src/services/firestore/files.repo.ts`:

```ts
import { query, type Query } from "firebase/firestore";
import { refs } from "./paths";
import type { ProjectFile } from "./types";

/** The whole working tree (≤ 25 files, ≤ 300 KB) — small enough to listen to in full. */
export const filesQuery = (
  uid: string,
  projectId: string,
): Query<ProjectFile> => query(refs.files(uid, projectId));
```

`frontend/src/features/workspace/workspace-context.ts`:

```ts
import {
  inject,
  provide,
  type InjectionKey,
  type Ref,
  type ShallowRef,
} from "vue";
import type { Project, ProjectFile } from "@/services/firestore/types";
import type { EditorModels } from "./editor/editor-models";

/** Per-project context provided by WorkspacePage to every panel. Non-reactive objects stay raw. */
export interface WorkspaceContext {
  readonly uid: string;
  readonly projectId: string;
  readonly project: ShallowRef<Project | null>;
  readonly files: ShallowRef<ProjectFile[]>;
  readonly filesLoading: Ref<boolean>;
  readonly models: EditorModels;
}

const WorkspaceKey: InjectionKey<WorkspaceContext> = Symbol("workspace");

export function provideWorkspace(context: WorkspaceContext): void {
  provide(WorkspaceKey, context);
}

export function useWorkspace(): WorkspaceContext {
  const context = inject(WorkspaceKey);
  if (!context)
    throw new Error("useWorkspace() must be used inside WorkspacePage");
  return context;
}
```

`frontend/src/features/workspace/stores/workspace.store.ts`:

```ts
import { useLocalStorage } from "@vueuse/core";
import { defineStore } from "pinia";
import { ref } from "vue";

export type MobileTab = "chat" | "code" | "preview";

export interface SaveConflict {
  path: string;
  remoteVersion: number;
}

/** Ephemeral UI state of one open project. Durable data lives in Firestore listeners. */
export const useWorkspaceStore = defineStore("workspace", () => {
  const projectId = ref<string | null>(null);
  const openPaths = ref<string[]>([]);
  const activePath = ref<string | null>(null);
  const dirtyPaths = ref<string[]>([]);
  const conflictPaths = ref<string[]>([]);
  const saveConflict = ref<SaveConflict | null>(null);
  const savingPath = ref<string | null>(null);
  const previewNonce = ref(0);
  const consoleOpen = ref(false);
  const historyOpen = ref(false);
  const mobileTab = ref<MobileTab>("chat");
  const followGeneration = useLocalStorage("genesis-follow-generation", true);
  const treeCollapsed = useLocalStorage("genesis-tree-collapsed", false);

  function reset(nextProjectId: string): void {
    projectId.value = nextProjectId;
    openPaths.value = [];
    activePath.value = null;
    dirtyPaths.value = [];
    conflictPaths.value = [];
    saveConflict.value = null;
    savingPath.value = null;
    previewNonce.value = 0;
    consoleOpen.value = false;
    historyOpen.value = false;
    mobileTab.value = "chat";
  }

  function openFile(path: string, activate = true): void {
    if (!openPaths.value.includes(path))
      openPaths.value = [...openPaths.value, path];
    if (activate) activePath.value = path;
  }

  function closeFile(path: string): void {
    const index = openPaths.value.indexOf(path);
    if (index === -1) return;
    const next = openPaths.value.filter((p) => p !== path);
    openPaths.value = next;
    if (activePath.value === path)
      activePath.value = next[Math.min(index, next.length - 1)] ?? null;
  }

  const toggle = (list: typeof dirtyPaths, path: string, on: boolean): void => {
    const has = list.value.includes(path);
    if (on && !has) list.value = [...list.value, path];
    if (!on && has) list.value = list.value.filter((p) => p !== path);
  };

  /** Drops tabs and flags for files that no longer exist (deleted by a generation or a restore). */
  function retainPaths(existing: readonly string[]): void {
    const keep = new Set(existing);
    for (const path of openPaths.value.filter((p) => !keep.has(p)))
      closeFile(path);
    dirtyPaths.value = dirtyPaths.value.filter((p) => keep.has(p));
    conflictPaths.value = conflictPaths.value.filter((p) => keep.has(p));
  }

  return {
    projectId,
    openPaths,
    activePath,
    dirtyPaths,
    conflictPaths,
    saveConflict,
    savingPath,
    previewNonce,
    consoleOpen,
    historyOpen,
    mobileTab,
    followGeneration,
    treeCollapsed,
    reset,
    openFile,
    closeFile,
    setDirty: (path: string, dirty: boolean) => toggle(dirtyPaths, path, dirty),
    setConflict: (path: string, on: boolean) => toggle(conflictPaths, path, on),
    retainPaths,
    reloadPreview: () => void (previewNonce.value += 1),
  };
});
```

`frontend/src/features/workspace/composables/useProjectFiles.ts`:

```ts
import {
  useFirestoreQuery,
  type FirestoreQueryState,
} from "@/composables/useFirestoreQuery";
import { filesQuery } from "@/services/firestore/files.repo";
import type { ProjectFile } from "@/services/firestore/types";

export function useProjectFiles(
  uid: string,
  projectId: string,
): FirestoreQueryState<ProjectFile> {
  return useFirestoreQuery(() => filesQuery(uid, projectId));
}
```

`frontend/src/features/workspace/WorkspacePage.vue`:

```vue
<script setup lang="ts">
import { onBeforeUnmount } from "vue";
import PageState from "@/components/common/PageState.vue";
import { useAuth } from "@/composables/useAuth";
import { useFirestoreDoc } from "@/composables/useFirestoreDoc";
import SnapshotHistorySheet from "@/features/snapshots/SnapshotHistorySheet.vue";
import { toUserMessage } from "@/lib/errors";
import { refs } from "@/services/firestore/paths";
import { useGeneration } from "./composables/useGeneration";
import { useProjectFiles } from "./composables/useProjectFiles";
import { useRemoteFileSync } from "./composables/useRemoteFileSync";
import { useStreamingEditor } from "./composables/useStreamingEditor";
import { useWorkspaceShortcuts } from "./composables/useWorkspaceShortcuts";
import { EditorModels } from "./editor/editor-models";
import { setupMonaco } from "./editor/monaco-setup";
import { useWorkspaceStore } from "./stores/workspace.store";
import { provideWorkspace } from "./workspace-context";
import WorkspaceHeader from "./WorkspaceHeader.vue";
import WorkspaceLayout from "./WorkspaceLayout.vue";

// The route guard guarantees a user; the page is keyed by path, so projectId is fixed for its lifetime.
const props = defineProps<{ projectId: string }>();
const { uid: authUid } = useAuth();
const uid = authUid.value ?? "";

const workspace = useWorkspaceStore();
workspace.reset(props.projectId);

const project = useFirestoreDoc(() => refs.project(uid, props.projectId));
const files = useProjectFiles(uid, props.projectId);
const models = new EditorModels(setupMonaco(), props.projectId, {
  onDirtyChange: (path, dirty) => workspace.setDirty(path, dirty),
});

provideWorkspace({
  uid,
  projectId: props.projectId,
  project: project.data,
  files: files.data,
  filesLoading: files.loading,
  models,
});

useGeneration();
useStreamingEditor();
useRemoteFileSync();
useWorkspaceShortcuts();

onBeforeUnmount(() => models.disposeAll());
</script>

<template>
  <PageState
    v-if="project.loading.value"
    kind="loading"
    title="Opening project"
    class="h-dvh"
  />
  <PageState
    v-else-if="project.error.value"
    kind="error"
    class="h-dvh"
    title="Couldn't open this project"
    :description="toUserMessage(project.error.value)"
    action-label="Back to projects"
    :action-to="{ name: 'dashboard' }"
  />
  <PageState
    v-else-if="!project.data.value || project.data.value.status === 'deleted'"
    kind="empty"
    class="h-dvh"
    title="Project not found"
    description="It may have been deleted."
    action-label="Back to projects"
    :action-to="{ name: 'dashboard' }"
  />
  <div v-else class="flex h-dvh flex-col bg-background">
    <WorkspaceHeader />
    <WorkspaceLayout />
    <SnapshotHistorySheet />
  </div>
</template>
```

`frontend/src/features/workspace/WorkspaceHeader.vue`:

```vue
<script setup lang="ts">
import { ArrowLeftIcon, HistoryIcon, PencilIcon } from "@lucide/vue";
import { ref } from "vue";
import { RouterLink } from "vue-router";
import { toast } from "vue-sonner";
import UserMenu from "@/components/common/UserMenu.vue";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import ConnectionBadge from "@/features/highlevel/ConnectionBadge.vue";
import ProjectFormDialog from "@/features/projects/ProjectFormDialog.vue";
import type { ProjectFormValues } from "@/features/projects/project-form.schema";
import { updateProject } from "@/services/firestore/projects.repo";
import GenerationStatusPill from "./chat/GenerationStatusPill.vue";
import { useWorkspaceStore } from "./stores/workspace.store";
import { useWorkspace } from "./workspace-context";

const ws = useWorkspace();
const workspace = useWorkspaceStore();
const renameOpen = ref(false);

async function rename(values: ProjectFormValues): Promise<void> {
  await updateProject(ws.uid, ws.projectId, values);
  toast.success("Project updated");
}
</script>

<template>
  <header class="flex h-12 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          as-child
          variant="ghost"
          size="icon-sm"
          aria-label="Back to projects"
        >
          <RouterLink :to="{ name: 'dashboard' }"><ArrowLeftIcon /></RouterLink>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Projects</TooltipContent>
    </Tooltip>
    <button
      type="button"
      class="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium hover:bg-muted"
      :aria-label="`Rename ${ws.project.value?.name ?? 'project'}`"
      @click="renameOpen = true"
    >
      <span class="truncate">{{ ws.project.value?.name }}</span>
      <PencilIcon
        class="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
      />
    </button>
    <GenerationStatusPill />
    <div class="ml-auto flex items-center gap-2">
      <ConnectionBadge />
      <Button variant="outline" size="sm" @click="workspace.historyOpen = true">
        <HistoryIcon />Snapshots
      </Button>
      <UserMenu />
    </div>
    <ProjectFormDialog
      v-model:open="renameOpen"
      :project="ws.project.value"
      :submit="rename"
    />
  </header>
</template>
```

`frontend/src/features/workspace/WorkspaceLayout.vue`:

```vue
<script setup lang="ts">
import { useMediaQuery } from "@vueuse/core";
import { storeToRefs } from "pinia";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ChatPanel from "./chat/ChatPanel.vue";
import CodePanel from "./editor/CodePanel.vue";
import PreviewPanel from "./preview/PreviewPanel.vue";
import { useWorkspaceStore, type MobileTab } from "./stores/workspace.store";

const wide = useMediaQuery("(min-width: 1024px)");
const workspace = useWorkspaceStore();
const { mobileTab } = storeToRefs(workspace);

function onTab(value: unknown): void {
  if (value === "chat" || value === "code" || value === "preview")
    mobileTab.value = value satisfies MobileTab;
}
</script>

<template>
  <ResizablePanelGroup
    v-if="wide"
    direction="horizontal"
    auto-save-id="genesis-workspace"
    class="min-h-0 flex-1"
  >
    <ResizablePanel :default-size="28" :min-size="20"
      ><ChatPanel
    /></ResizablePanel>
    <ResizableHandle with-handle />
    <ResizablePanel :default-size="40" :min-size="25"
      ><CodePanel
    /></ResizablePanel>
    <ResizableHandle with-handle />
    <ResizablePanel :default-size="32" :min-size="20"
      ><PreviewPanel
    /></ResizablePanel>
  </ResizablePanelGroup>
  <Tabs
    v-else
    :model-value="mobileTab"
    :unmount-on-hide="false"
    class="flex min-h-0 flex-1 flex-col gap-0"
    @update:model-value="onTab"
  >
    <TabsList class="mx-2 mt-2 grid grid-cols-3">
      <TabsTrigger value="chat">Chat</TabsTrigger>
      <TabsTrigger value="code">Code</TabsTrigger>
      <TabsTrigger value="preview">Preview</TabsTrigger>
    </TabsList>
    <!-- Panels stay mounted (unmount-on-hide="false" on Tabs) so streams, models and the preview survive tab switches. -->
    <TabsContent
      value="chat"
      class="min-h-0 flex-1 data-[state=inactive]:hidden"
      ><ChatPanel
    /></TabsContent>
    <TabsContent
      value="code"
      class="min-h-0 flex-1 data-[state=inactive]:hidden"
      ><CodePanel
    /></TabsContent>
    <TabsContent
      value="preview"
      class="min-h-0 flex-1 data-[state=inactive]:hidden"
      ><PreviewPanel
    /></TabsContent>
  </Tabs>
</template>
```

≥ 1024 px: three resizable panels whose sizes persist (`auto-save-id`); narrower: Chat / Code / Preview tabs that keep all three panels mounted so a running stream, Monaco models and the preview survive tab switches.

- [ ] **Step 3: Run** `npm test` → PASS; open a project → header shows name, badge, Snapshots button; resize panels, reload — sizes persist; at 390 px width the tabs appear.

- [ ] **Step 4: Commit** — `feat(frontend): add workspace shell, context and store`

---

### Task FE-3.2: Chat history

**Files:**

- Create: `frontend/src/services/firestore/messages.repo.ts`, `frontend/src/features/workspace/composables/useProjectMessages.ts`, `chat/message-meta.ts`, `chat/MessageItem.vue`, `chat/MessageList.vue`
- Test: `frontend/tests/features/workspace/chat/message-meta.test.ts`

**Interfaces:** Produces `messagesQuery(uid, projectId)` (last 200 by `createdAt`), `useProjectMessages(uid, projectId)`, `describeMessageMeta(role, meta) → { text, tone } | null`, `formatPaths(paths, max?)`. Message meta written by the backend carries `snapshotSeq`, `changedPaths`, `deletedPaths`, `rejectedPaths`, `status` (BE-6.4).

- [ ] **Step 1: Failing test**

`frontend/tests/features/workspace/chat/message-meta.test.ts`:

```ts
import { describeMessageMeta } from "@/features/workspace/chat/message-meta";

describe("describeMessageMeta", () => {
  it("summarizes a completed generation", () => {
    expect(
      describeMessageMeta("assistant", {
        status: "completed",
        changedPaths: ["index.html", "app.js"],
        snapshotSeq: 4,
        rejectedPaths: ["x.js"],
      }),
    ).toEqual({
      text: "Changed index.html, app.js · Snapshot #4 · 1 file rejected",
      tone: "warning",
    });
  });
  it("shortens long lists and handles outcomes", () => {
    expect(
      describeMessageMeta("system", {
        changedPaths: ["a.js", "b.js", "c.js", "d.js"],
        snapshotSeq: 8,
      })?.text,
    ).toBe("Changed a.js, b.js, c.js +1 more · Snapshot #8");
    expect(describeMessageMeta("assistant", { status: "failed" })).toEqual({
      text: "Generation failed",
      tone: "error",
    });
    expect(describeMessageMeta("user", { status: "completed" })).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

`frontend/src/services/firestore/messages.repo.ts`:

```ts
import { limitToLast, orderBy, query, type Query } from "firebase/firestore";
import { refs } from "./paths";
import type { ChatMessage } from "./types";

export const MESSAGE_WINDOW = 200;

export const messagesQuery = (
  uid: string,
  projectId: string,
): Query<ChatMessage> =>
  query(
    refs.messages(uid, projectId),
    orderBy("createdAt", "asc"),
    limitToLast(MESSAGE_WINDOW),
  );
```

`frontend/src/features/workspace/composables/useProjectMessages.ts`:

```ts
import {
  useFirestoreQuery,
  type FirestoreQueryState,
} from "@/composables/useFirestoreQuery";
import { messagesQuery } from "@/services/firestore/messages.repo";
import type { ChatMessage } from "@/services/firestore/types";

export function useProjectMessages(
  uid: string,
  projectId: string,
): FirestoreQueryState<ChatMessage> {
  return useFirestoreQuery(() => messagesQuery(uid, projectId));
}
```

`frontend/src/features/workspace/chat/message-meta.ts`:

```ts
import type { MessageMeta } from "@/contracts/firestore-docs";

export interface MetaLine {
  text: string;
  tone: "muted" | "warning" | "error";
}

export function formatPaths(paths: readonly string[], max = 3): string {
  const shown = paths.slice(0, max).join(", ");
  return paths.length > max ? `${shown} +${paths.length - max} more` : shown;
}

/** The small line under an assistant/system message: "Changed app.js, styles.css · Snapshot #4". */
export function describeMessageMeta(
  role: "user" | "assistant" | "system",
  meta: MessageMeta | null,
): MetaLine | null {
  if (!meta || role === "user") return null;
  if (meta.status === "failed")
    return { text: "Generation failed", tone: "error" };
  if (meta.status === "cancelled") return { text: "Cancelled", tone: "muted" };
  if (meta.status === "interrupted")
    return { text: "Interrupted", tone: "warning" };

  const parts: string[] = [];
  const changed = meta.changedPaths ?? [];
  const deleted = meta.deletedPaths ?? [];
  if (changed.length > 0) parts.push(`Changed ${formatPaths(changed)}`);
  if (deleted.length > 0) parts.push(`Deleted ${formatPaths(deleted)}`);
  if (
    changed.length === 0 &&
    deleted.length === 0 &&
    meta.status === "completed"
  )
    parts.push("No file changes");
  if (typeof meta.snapshotSeq === "number")
    parts.push(`Snapshot #${meta.snapshotSeq}`);
  const rejected = meta.rejectedPaths?.length ?? 0;
  if (rejected > 0)
    parts.push(`${rejected} file${rejected === 1 ? "" : "s"} rejected`);
  return parts.length > 0
    ? { text: parts.join(" · "), tone: rejected > 0 ? "warning" : "muted" }
    : null;
}
```

`frontend/src/features/workspace/chat/MessageItem.vue`:

```vue
<script setup lang="ts">
import { computed } from "vue";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/services/firestore/types";
import { describeMessageMeta } from "./message-meta";

const props = defineProps<{ message: ChatMessage }>();
const meta = computed(() =>
  describeMessageMeta(props.message.role, props.message.meta),
);
</script>

<template>
  <div
    v-if="props.message.role === 'system'"
    class="flex items-center gap-3 py-1 text-xs text-muted-foreground"
  >
    <span class="h-px flex-1 bg-border" aria-hidden="true" />
    <span
      >{{ props.message.content
      }}<template v-if="meta"> · {{ meta.text }}</template></span
    >
    <span class="h-px flex-1 bg-border" aria-hidden="true" />
  </div>
  <div
    v-else-if="props.message.role === 'user'"
    class="rounded-lg border bg-muted/40 px-3 py-2"
  >
    <p class="mb-1 text-[11px] font-medium text-muted-foreground">You</p>
    <p class="text-sm whitespace-pre-wrap">{{ props.message.content }}</p>
  </div>
  <div v-else class="px-1">
    <p class="mb-1 text-[11px] font-medium text-muted-foreground">Genesis</p>
    <p class="text-sm whitespace-pre-wrap">{{ props.message.content }}</p>
    <p
      v-if="meta"
      :class="
        cn('mt-1.5 text-xs', {
          'text-muted-foreground': meta.tone === 'muted',
          'text-warning': meta.tone === 'warning',
          'text-destructive': meta.tone === 'error',
        })
      "
    >
      {{ meta.text }}
    </p>
  </div>
</template>
```

`frontend/src/features/workspace/chat/MessageList.vue`:

```vue
<script setup lang="ts">
import { ArrowDownIcon } from "@lucide/vue";
import { useEventListener } from "@vueuse/core";
import { nextTick, onMounted, ref, shallowRef, watch } from "vue";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChatMessage } from "@/services/firestore/types";
import MessageItem from "./MessageItem.vue";

const props = defineProps<{
  messages: ChatMessage[];
  loading: boolean;
  liveKey: string;
}>();

const root = ref<HTMLElement | null>(null);
const viewport = shallowRef<HTMLElement | null>(null);
const pinned = ref(true);

function scrollToBottom(): void {
  const el = viewport.value;
  if (el) el.scrollTop = el.scrollHeight;
}

onMounted(() => {
  viewport.value =
    root.value?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    ) ?? null;
  scrollToBottom();
});

useEventListener(viewport, "scroll", () => {
  const el = viewport.value;
  if (el) pinned.value = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
});

// Stick to the bottom as messages and live text arrive, unless the user scrolled up to read.
watch(
  () => [props.messages.length, props.liveKey],
  async () => {
    if (!pinned.value) return;
    await nextTick();
    scrollToBottom();
  },
);
</script>

<template>
  <div ref="root" class="relative min-h-0 flex-1">
    <ScrollArea class="h-full">
      <div class="flex flex-col gap-4 p-4">
        <template v-if="props.loading">
          <Skeleton class="h-14 w-3/4 self-end" />
          <Skeleton class="h-20 w-5/6" />
        </template>
        <MessageItem
          v-for="message in props.messages"
          :key="message.id"
          :message="message"
        />
        <slot />
      </div>
    </ScrollArea>
    <Button
      v-if="!pinned"
      size="sm"
      variant="secondary"
      class="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-sm"
      @click="scrollToBottom"
    >
      <ArrowDownIcon />Jump to latest
    </Button>
  </div>
</template>
```

The transcript is document-like (labels "You" / "Genesis", system notes as dividers), not consumer chat bubbles (design brief).

- [ ] **Step 3: Run** `npm test` → PASS. **Commit** — `feat(frontend): add chat history with change summaries`

---

### Task FE-3.3: Prompt composer, example prompts, chat panel

**Files:**

- Create: `frontend/src/features/workspace/chat/PromptComposer.vue`, `ExamplePrompts.vue`, `ChatPanel.vue`
- Test: `frontend/tests/features/workspace/chat/PromptComposer.test.ts`

**Interfaces:** `PromptComposer` props `{ busy, blockedReason, hlConnected }`, `v-model` text, emits `submit(prompt)`. No Stop control (assignment bonus R-B1). `ChatPanel` composes list, live message (FE-4.3), outcome banner (FE-4.5) and composer; it blocks sending while offline or while there are unsaved editor changes (so a generation never overwrites unsaved text).

- [ ] **Step 1: Failing test**

`frontend/tests/features/workspace/chat/PromptComposer.test.ts`:

```ts
import { mount } from "@vue/test-utils";
import PromptComposer from "@/features/workspace/chat/PromptComposer.vue";

const props = { busy: false, blockedReason: null, hlConnected: true };

describe("PromptComposer", () => {
  it("submits with Cmd/Ctrl+Enter and clears", async () => {
    const wrapper = mount(PromptComposer, {
      props: {
        ...props,
        modelValue: "Add a search box",
        "onUpdate:modelValue": (v: string) =>
          wrapper.setProps({ modelValue: v }),
      },
    });
    await wrapper
      .get("textarea")
      .trigger("keydown", { key: "Enter", ctrlKey: true });
    expect(wrapper.emitted("submit")).toEqual([["Add a search box"]]);
    expect(wrapper.props("modelValue")).toBe("");
  });

  it("is disabled when blocked, empty or too long", async () => {
    const wrapper = mount(PromptComposer, {
      props: { ...props, modelValue: "", blockedReason: "You're offline." },
    });
    expect(wrapper.text()).toContain("You're offline.");
    const send = wrapper
      .findAll("button")
      .find((b) => b.text().includes("Send"))!;
    expect(send.attributes("disabled")).toBeDefined();
    await wrapper.setProps({
      blockedReason: null,
      modelValue: "x".repeat(4001),
    });
    expect(wrapper.text()).toContain("4001/4000");
    expect(send.attributes("disabled")).toBeDefined();
  });

  it("disables Send while generating", () => {
    const wrapper = mount(PromptComposer, {
      props: { ...props, busy: true, modelValue: "hi" },
    });
    const send = wrapper
      .findAll("button")
      .find((b) => b.text().includes("Send"));
    expect(send?.attributes("disabled")).toBeDefined();
  });
});
```

- [ ] **Step 2: Implement**

`frontend/src/features/workspace/chat/PromptComposer.vue`:

```vue
<script setup lang="ts">
import { SendIcon } from "@lucide/vue";
import { useTextareaAutosize } from "@vueuse/core";
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LIMITS } from "@/contracts/limits";
import { cn } from "@/lib/utils";

const props = defineProps<{
  /** A generation is running (Send disabled). */
  busy: boolean;
  /** Why sending is blocked right now (offline, unsaved edits…), or null. */
  blockedReason: string | null;
  hlConnected: boolean;
}>();
const emit = defineEmits<{ submit: [prompt: string] }>();
const text = defineModel<string>({ default: "" });

const box = ref<HTMLElement | null>(null);
const element = computed(() => box.value?.querySelector("textarea") ?? null);
useTextareaAutosize({ element, input: text, maxHeight: 240 });

const length = computed(() => text.value.length);
const tooLong = computed(() => length.value > LIMITS.promptMaxChars);
const canSend = computed(
  () =>
    !props.busy &&
    props.blockedReason === null &&
    text.value.trim().length > 0 &&
    !tooLong.value,
);
const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

function send(): void {
  if (!canSend.value) return;
  emit("submit", text.value.trim());
  text.value = "";
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    send();
  }
}
</script>

<template>
  <div class="border-t bg-background p-3">
    <p v-if="!props.hlConnected" class="mb-2 text-xs text-muted-foreground">
      You can generate now — connect HighLevel to see live data in the preview.
    </p>
    <div
      ref="box"
      class="rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring/40"
    >
      <label for="prompt" class="sr-only"
        >Describe what to build or change</label
      >
      <Textarea
        id="prompt"
        v-model="text"
        rows="3"
        :disabled="props.busy"
        placeholder="Describe the app, or what to change…"
        class="max-h-60 min-h-18 resize-none border-0 shadow-none focus-visible:ring-0"
        :aria-invalid="tooLong"
        @keydown="onKeydown"
      />
      <div class="flex items-center gap-2 px-2 pb-2">
        <span
          :class="
            cn(
              'text-xs tabular-nums',
              tooLong ? 'text-destructive' : 'text-muted-foreground',
            )
          "
        >
          {{ length }}/{{ LIMITS.promptMaxChars }}
        </span>
        <span
          v-if="props.blockedReason"
          class="truncate text-xs text-muted-foreground"
          role="status"
        >
          {{ props.blockedReason }}
        </span>
        <span v-else class="hidden text-xs text-muted-foreground sm:inline">
          {{ isMac ? "⌘" : "Ctrl" }}+Enter to send
        </span>
        <Button
          class="ml-auto"
          size="sm"
          :disabled="!canSend || props.busy"
          @click="send"
        >
          <SendIcon />Send
        </Button>
      </div>
    </div>
  </div>
</template>
```

`frontend/src/features/workspace/chat/ExamplePrompts.vue`:

```vue
<script setup lang="ts">
import { Button } from "@/components/ui/button";

const emit = defineEmits<{ pick: [prompt: string] }>();

const EXAMPLES = [
  "Contact dashboard with search and upcoming appointments",
  "Conversations inbox with a message thread",
  "This week's calendar appointments",
] as const;
</script>

<template>
  <div class="flex flex-col gap-2 px-4 pb-2">
    <p class="text-xs text-muted-foreground">Start from an example</p>
    <div class="flex flex-wrap gap-2">
      <Button
        v-for="example in EXAMPLES"
        :key="example"
        variant="outline"
        size="sm"
        class="h-auto py-1.5 text-left whitespace-normal"
        @click="emit('pick', example)"
      >
        {{ example }}
      </Button>
    </div>
  </div>
</template>
```

`frontend/src/features/workspace/chat/ChatPanel.vue`:

```vue
<script setup lang="ts">
import { useOnline } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { useHighLevelConnection } from "@/features/highlevel/useHighLevelConnection";
import { useProjectMessages } from "../composables/useProjectMessages";
import { isActive } from "../stores/generation.reducer";
import { useGenerationStore } from "../stores/generation.store";
import { useWorkspaceStore } from "../stores/workspace.store";
import { useWorkspace } from "../workspace-context";
import ExamplePrompts from "./ExamplePrompts.vue";
import GenerationOutcomeBanner from "./GenerationOutcomeBanner.vue";
import LiveAssistantMessage from "./LiveAssistantMessage.vue";
import MessageList from "./MessageList.vue";
import PromptComposer from "./PromptComposer.vue";

const ws = useWorkspace();
const generation = useGenerationStore();
const workspace = useWorkspaceStore();
const { state } = storeToRefs(generation);
const { status: hlStatus } = useHighLevelConnection();
const online = useOnline();
const { data: messages, loading } = useProjectMessages(ws.uid, ws.projectId);
const draft = ref("");

// Hide the live message once the persisted assistant message for this generation arrives.
const persisted = computed(() =>
  messages.value.some(
    (m) =>
      m.role === "assistant" && m.generationId === state.value.generationId,
  ),
);
const showLive = computed(
  () => state.value.status !== "idle" && !persisted.value,
);
const busy = computed(() => isActive(state.value.status));
const liveKey = computed(
  () =>
    `${state.value.prose.length}:${state.value.fileOrder.length}:${state.value.status}`,
);
const empty = computed(
  () =>
    !loading.value &&
    messages.value.length === 0 &&
    ws.files.value.length === 0,
);

const blockedReason = computed(() => {
  if (!online.value) return "You're offline.";
  if (workspace.dirtyPaths.length > 0)
    return "Save or discard unsaved changes first.";
  return null;
});

function openFile(path: string): void {
  workspace.openFile(path);
  workspace.mobileTab = "code";
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col" aria-label="Chat">
    <MessageList :messages="messages" :loading="loading" :live-key="liveKey">
      <LiveAssistantMessage
        v-if="showLive"
        :state="state"
        @open-file="openFile"
      />
    </MessageList>
    <GenerationOutcomeBanner />
    <ExamplePrompts v-if="empty && !busy" @pick="draft = $event" />
    <PromptComposer
      v-model="draft"
      :busy="busy"
      :blocked-reason="blockedReason"
      :hl-connected="hlStatus === 'connected'"
      @submit="generation.start($event)"
    />
  </section>
</template>
```

- [ ] **Step 3: Run** `npm test` → PASS. **Commit** — `feat(frontend): add prompt composer and chat panel`
