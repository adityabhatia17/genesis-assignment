# FE-5 — Code editor (R-FE4, R-BE7)

> Read [`00-overview.md`](00-overview.md) first. Spec: [`../06-frontend-system-design.md`](../06-frontend-system-design.md) §12; save flow: [`../07-end-to-end-system-design.md`](../07-end-to-end-system-design.md) §4.11, A12.

---

### Task FE-5.1: Bundle Monaco locally

**Files:**

- Create: `frontend/src/features/workspace/editor/monaco-setup.ts`

**Interfaces:** Produces `setupMonaco(): Monaco` (idempotent). Imported only from the workspace route chunk, so Monaco never loads on the auth or dashboard pages.

> `monaco-editor` ≥ 0.56 publishes an `exports` map rooted at `esm/vs/`. The classic specifiers `monaco-editor/esm/vs/editor/editor.worker` no longer resolve; use `monaco-editor/editor/editor.worker` and `monaco-editor/language/<lang>/<lang>.worker` as below.

- [ ] **Step 1: Implement**

`frontend/src/features/workspace/editor/monaco-setup.ts`:

```ts
import { loader } from "@guolao/vue-monaco-editor";
import * as monaco from "monaco-editor";
// monaco-editor ≥ 0.56 ships an exports map rooted at esm/vs: these are the worker entry points.
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import CssWorker from "monaco-editor/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";

export type Monaco = typeof monaco;

let configured = false;

/** Bundles Monaco locally (no CDN) and wires its workers through Vite. Only the workspace chunk imports this. */
export function setupMonaco(): Monaco {
  if (!configured) {
    globalThis.MonacoEnvironment = {
      getWorker(_workerId: string, label: string): Worker {
        switch (label) {
          case "css":
          case "scss":
          case "less":
            return new CssWorker();
          case "html":
          case "handlebars":
          case "razor":
            return new HtmlWorker();
          case "json":
            return new JsonWorker();
          case "javascript":
          case "typescript":
            return new TsWorker();
          default:
            return new EditorWorker();
        }
      },
    };
    loader.config({ monaco });
    configured = true;
  }
  return monaco;
}
```

- [ ] **Step 2: Verify** — `npm run build` emits `*.worker-*.js` assets and no request goes to jsDelivr in the Network tab. **Commit** — `feat(frontend): bundle Monaco and its workers locally`

---

### Task FE-5.2: Editor models — unsaved text, streaming, conflicts

**Files:**

- Create: `frontend/src/features/workspace/editor/editor-models.ts`, `frontend/tests/helpers/fake-monaco.ts`
- Test: `frontend/tests/features/workspace/editor/editor-models.test.ts`

**Interfaces:** Produces `class EditorModels(monaco, projectId, { onDirtyChange?, schedule? })` with `uri, get, ensure, isDirty, dirtyPaths, streamingPaths, baseVersion, conflictOf, saveViewState, viewState, syncFromRemote(file) → 'absent' | 'unchanged' | 'updated' | 'conflict' | 'streaming', beginSave, completeSave, abortSave, acceptRemoteVersion, takeRemote, discardChanges, beginStream, append, endStream, settleStreams(outcome), flushAll, retain, dispose, disposeAll`; `RemoteFile`, `MonacoModelApi`.

Key rules: one model per `file:///<projectId>/<path>` URI; dirty = Monaco alternative version ≠ version at last sync/save; streamed tokens are appended with `applyEdits` once per animation frame (never `setValue` per token); a stream that is rejected or does not commit restores the previous text (or disposes a new file's model); the listener echo of our own save is recognized by content.

- [ ] **Step 1: Fake Monaco and failing tests**

`frontend/tests/helpers/fake-monaco.ts`:

```ts
import type * as Monaco from "monaco-editor";
import type { MonacoModelApi } from "@/features/workspace/editor/editor-models";

/** Just enough of ITextModel for EditorModels: text, alternative version ids, change events. */
export class FakeModel {
  private text: string;
  private alt = 1;
  private readonly listeners = new Set<() => void>();
  disposed = false;

  constructor(
    value: string,
    readonly language: string | undefined,
    readonly uri: string,
  ) {
    this.text = value;
  }
  getValue(): string {
    return this.text;
  }
  setValue(value: string): void {
    this.text = value;
    this.changed();
  }
  getAlternativeVersionId(): number {
    return this.alt;
  }
  getLineCount(): number {
    return this.text.split("\n").length;
  }
  getLineMaxColumn(line: number): number {
    return (this.text.split("\n")[line - 1] ?? "").length + 1;
  }
  applyEdits(edits: { text: string }[]): void {
    this.text += edits.map((e) => e.text).join(""); // EditorModels only appends at the end
    this.changed();
  }
  /** Simulates the user typing. */
  type(value: string): void {
    this.text += value;
    this.changed();
  }
  onDidChangeContent(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }
  dispose(): void {
    this.disposed = true;
  }
  private changed(): void {
    this.alt += 1;
    this.listeners.forEach((l) => l());
  }
}

export function fakeMonaco(): MonacoModelApi & { models: FakeModel[] } {
  const models: FakeModel[] = [];
  return {
    models,
    Uri: { parse: (value: string) => value as unknown as Monaco.Uri },
    editor: {
      createModel: (value: string, language?: string, uri?: Monaco.Uri) => {
        const model = new FakeModel(value, language, String(uri));
        models.push(model);
        return model as unknown as Monaco.editor.ITextModel;
      },
    },
  };
}
```

`frontend/tests/features/workspace/editor/editor-models.test.ts`:

```ts
import {
  EditorModels,
  type RemoteFile,
} from "@/features/workspace/editor/editor-models";
import { fakeMonaco, type FakeModel } from "../../../helpers/fake-monaco";

const file = (path: string, content: string, version = 1): RemoteFile => ({
  path,
  content,
  version,
  language: "javascript",
});

function setup() {
  const monaco = fakeMonaco();
  const dirty: [string, boolean][] = [];
  let flush: (() => void) | null = null;
  const models = new EditorModels(monaco, "p1", {
    onDirtyChange: (path, value) => dirty.push([path, value]),
    schedule: (fn) => (flush = fn),
  });
  const model = (path: string) => models.get(path) as unknown as FakeModel;
  return { models, dirty, model, flush: () => flush?.() };
}

describe("EditorModels", () => {
  it("creates one model per file URI and tracks unsaved edits", () => {
    const { models, dirty, model } = setup();
    models.ensure(file("app.js", "a"));
    expect(model("app.js").uri).toBe("file:///p1/app.js");
    model("app.js").type("b");
    expect(models.isDirty("app.js")).toBe(true);
    expect(dirty).toEqual([["app.js", true]]);
  });

  it("applies remote updates to clean models and flags conflicts on dirty ones", () => {
    const { models, model } = setup();
    models.ensure(file("app.js", "a", 1));
    expect(models.syncFromRemote(file("app.js", "b", 2))).toBe("updated");
    expect(model("app.js").getValue()).toBe("b");
    model("app.js").type("!");
    expect(models.syncFromRemote(file("app.js", "c", 3))).toBe("conflict");
    expect(models.conflictOf("app.js")?.version).toBe(3);
    models.takeRemote(file("app.js", "c", 3));
    expect(model("app.js").getValue()).toBe("c");
    expect(models.isDirty("app.js")).toBe(false);
  });

  it("treats the listener echo of our own save as saved", () => {
    const { models, model } = setup();
    models.ensure(file("app.js", "a", 1));
    model("app.js").type("b");
    const draft = models.beginSave("app.js");
    expect(draft).toEqual({ content: "ab", expectedVersion: 1 });
    expect(models.syncFromRemote(file("app.js", "ab", 2))).toBe("updated");
    expect(models.isDirty("app.js")).toBe(false);
    expect(models.baseVersion("app.js")).toBe(2);
  });

  it("keeps edits typed while a save is in flight", () => {
    const { models, model } = setup();
    models.ensure(file("app.js", "a", 1));
    model("app.js").type("b");
    models.beginSave("app.js");
    model("app.js").type("c");
    models.completeSave("app.js", 2);
    expect(models.isDirty("app.js")).toBe(true);
  });

  it("streams text in per-frame batches and keeps it when the generation commits", () => {
    const { models, model, flush } = setup();
    models.beginStream("new.js", "javascript");
    models.append("new.js", "let ");
    models.append("new.js", "x = 1;");
    expect(model("new.js").getValue()).toBe("");
    flush();
    expect(model("new.js").getValue()).toBe("let x = 1;");
    models.endStream("new.js", "valid");
    expect(models.syncFromRemote(file("new.js", "let x = 1;", 1))).toBe(
      "updated",
    );
    expect(models.isDirty("new.js")).toBe(false);
  });

  it("restores the previous text when a generation fails and drops files it created", () => {
    const { models, model } = setup();
    models.ensure(file("app.js", "old", 1));
    models.beginStream("app.js", "javascript");
    models.append("app.js", "new");
    models.beginStream("extra.js", "javascript");
    models.settleStreams("interrupted");
    expect(model("app.js").getValue()).toBe("old");
    expect(models.get("extra.js")).toBeNull();
  });

  it("reverts a rejected file immediately", () => {
    const { models, model } = setup();
    models.ensure(file("app.js", "old", 1));
    models.beginStream("app.js", "javascript");
    models.append("app.js", "broken");
    models.endStream("app.js", "rejected");
    expect(model("app.js").getValue()).toBe("old");
  });
});
```

- [ ] **Step 2: Implement**

`frontend/src/features/workspace/editor/editor-models.ts`:

```ts
import type * as Monaco from "monaco-editor";
import type { FileLanguage } from "@/contracts/paths";

type TextModel = Monaco.editor.ITextModel;
type ViewState = Monaco.editor.ICodeEditorViewState;

/** The slice of the Monaco API this class needs (tests pass a fake). */
export interface MonacoModelApi {
  editor: {
    createModel(value: string, language?: string, uri?: Monaco.Uri): TextModel;
  };
  Uri: { parse(value: string): Monaco.Uri };
}

/** A committed file as delivered by the Firestore listener (ProjectFile satisfies this). */
export interface RemoteFile {
  path: string;
  content: string;
  language: FileLanguage;
  version: number;
}

export type SyncResult =
  | "absent"
  | "unchanged"
  | "updated"
  | "conflict"
  | "streaming";
export type StreamOutcome =
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

interface Entry {
  model: TextModel;
  /** Firestore version the model was last synced or saved from (0 = never committed). */
  baseVersion: number;
  /** Monaco alternative version id at that moment; differing = unsaved edits. */
  savedAlt: number;
  savedContent: string;
  pendingSave: { content: string; alt: number } | null;
  conflict: RemoteFile | null;
  /** Set while a generation writes this file. original = null when the stream created the file. */
  stream: { original: string | null; done: boolean } | null;
  viewState: ViewState | null;
  dirty: boolean;
  subscription: Monaco.IDisposable;
}

export interface EditorModelsOptions {
  onDirtyChange?: (path: string, dirty: boolean) => void;
  /** Defers stream flushing; defaults to one flush per animation frame. */
  schedule?: (flush: () => void) => void;
}

/**
 * Owns one Monaco model per file (URI file:///<projectId>/<path>). Models outlive editor
 * components, so unsaved edits survive tab switches and layout changes (FSD §12).
 */
export class EditorModels {
  private readonly entries = new Map<string, Entry>();
  private readonly queue = new Map<string, string>();
  private flushScheduled = false;

  constructor(
    private readonly monaco: MonacoModelApi,
    private readonly projectId: string,
    private readonly options: EditorModelsOptions = {},
  ) {}

  uri(path: string): Monaco.Uri {
    return this.monaco.Uri.parse(`file:///${this.projectId}/${path}`);
  }

  get(path: string): TextModel | null {
    return this.entries.get(path)?.model ?? null;
  }

  /** Model for a committed file, created lazily the first time it is opened. */
  ensure(file: RemoteFile): TextModel {
    return (
      this.entries.get(file.path) ??
      this.create(file.path, file.content, file.language, file.version)
    ).model;
  }

  isDirty(path: string): boolean {
    return this.entries.get(path)?.dirty ?? false;
  }

  dirtyPaths(): string[] {
    return [...this.entries].filter(([, e]) => e.dirty).map(([path]) => path);
  }

  streamingPaths(): string[] {
    return [...this.entries]
      .filter(([, e]) => e.stream !== null)
      .map(([path]) => path);
  }

  baseVersion(path: string): number {
    return this.entries.get(path)?.baseVersion ?? 0;
  }

  conflictOf(path: string): RemoteFile | null {
    return this.entries.get(path)?.conflict ?? null;
  }

  saveViewState(path: string, state: ViewState | null): void {
    const e = this.entries.get(path);
    if (e) e.viewState = state;
  }

  viewState(path: string): ViewState | null {
    return this.entries.get(path)?.viewState ?? null;
  }

  /** Applies a listener update unless it would overwrite unsaved edits (then it records a conflict). */
  syncFromRemote(file: RemoteFile): SyncResult {
    const e = this.entries.get(file.path);
    if (!e) return "absent";
    if (e.stream) {
      if (!e.stream.done || file.content !== e.model.getValue())
        return "streaming";
      e.stream = null; // the commit landed before the terminal SSE event
      this.markSaved(
        file.path,
        e,
        file.version,
        e.model.getAlternativeVersionId(),
        file.content,
      );
      return "updated";
    }
    if (e.pendingSave && file.content === e.pendingSave.content) {
      this.markSaved(
        file.path,
        e,
        file.version,
        e.pendingSave.alt,
        file.content,
      ); // echo of our own save
      return "updated";
    }
    if (file.version <= e.baseVersion) return "unchanged";
    if (e.dirty) {
      e.conflict = file;
      return "conflict";
    }
    if (e.model.getValue() !== file.content) e.model.setValue(file.content);
    this.markSaved(
      file.path,
      e,
      file.version,
      e.model.getAlternativeVersionId(),
      file.content,
    );
    return "updated";
  }

  /** Snapshot of the text to save; the save is confirmed by completeSave or by the listener echo. */
  beginSave(path: string): { content: string; expectedVersion: number } | null {
    const e = this.entries.get(path);
    if (!e || e.stream) return null;
    const content = e.model.getValue();
    e.pendingSave = { content, alt: e.model.getAlternativeVersionId() };
    return { content, expectedVersion: e.baseVersion };
  }

  completeSave(path: string, version: number): void {
    const e = this.entries.get(path);
    if (e?.pendingSave)
      this.markSaved(
        path,
        e,
        version,
        e.pendingSave.alt,
        e.pendingSave.content,
      );
  }

  abortSave(path: string): void {
    const e = this.entries.get(path);
    if (e) e.pendingSave = null;
  }

  /** "Keep mine": build on the newer remote version without touching the text. */
  acceptRemoteVersion(path: string, version: number): void {
    const e = this.entries.get(path);
    if (!e) return;
    e.baseVersion = Math.max(e.baseVersion, version);
    e.conflict = null;
  }

  /** "Use theirs": replace the text with the committed file. */
  takeRemote(file: RemoteFile): void {
    const e = this.entries.get(file.path);
    if (!e) return;
    e.model.setValue(file.content);
    this.markSaved(
      file.path,
      e,
      file.version,
      e.model.getAlternativeVersionId(),
      file.content,
    );
  }

  discardChanges(path: string): void {
    const e = this.entries.get(path);
    if (!e || e.stream) return;
    e.model.setValue(e.savedContent);
    this.markSaved(
      path,
      e,
      e.baseVersion,
      e.model.getAlternativeVersionId(),
      e.savedContent,
    );
  }

  beginStream(path: string, language: FileLanguage): void {
    this.flushPath(path);
    const existing = this.entries.get(path);
    if (existing) {
      existing.stream = { original: existing.model.getValue(), done: false };
      existing.model.setValue("");
      return;
    }
    this.create(path, "", language, 0).stream = { original: null, done: false };
  }

  append(path: string, text: string): void {
    if (!this.entries.get(path)?.stream) return;
    this.queue.set(path, (this.queue.get(path) ?? "") + text);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    const schedule =
      this.options.schedule ??
      ((fn: () => void) => void requestAnimationFrame(() => fn()));
    schedule(() => {
      this.flushScheduled = false;
      this.flushAll();
    });
  }

  endStream(path: string, status: "valid" | "rejected"): void {
    const e = this.entries.get(path);
    if (!e?.stream) return;
    this.flushPath(path);
    if (status === "rejected") this.restoreOriginal(path, e);
    else e.stream.done = true; // keep the text until the generation's outcome is known
  }

  /** Generation ended: keep streamed text if it was committed, otherwise restore what was there. */
  settleStreams(outcome: StreamOutcome): void {
    this.flushAll();
    for (const [path, e] of [...this.entries]) {
      if (!e.stream) continue;
      if (outcome === "completed" && e.stream.done) {
        e.stream = null;
        e.savedAlt = e.model.getAlternativeVersionId();
        e.savedContent = e.model.getValue();
        this.refreshDirty(path, e);
      } else {
        this.restoreOriginal(path, e);
      }
    }
  }

  flushAll(): void {
    for (const path of [...this.queue.keys()]) this.flushPath(path);
  }

  /** Disposes models of files that no longer exist (never ones being streamed). */
  retain(paths: ReadonlySet<string>): void {
    for (const [path, e] of [...this.entries])
      if (!paths.has(path) && !e.stream) this.dispose(path);
  }

  dispose(path: string): void {
    const e = this.entries.get(path);
    if (!e) return;
    e.subscription.dispose();
    e.model.dispose();
    this.entries.delete(path);
    this.queue.delete(path);
  }

  disposeAll(): void {
    for (const path of [...this.entries.keys()]) this.dispose(path);
  }

  private create(
    path: string,
    content: string,
    language: FileLanguage,
    version: number,
  ): Entry {
    const model = this.monaco.editor.createModel(
      content,
      language,
      this.uri(path),
    );
    const entry: Entry = {
      model,
      baseVersion: version,
      savedAlt: model.getAlternativeVersionId(),
      savedContent: content,
      pendingSave: null,
      conflict: null,
      stream: null,
      viewState: null,
      dirty: false,
      subscription: model.onDidChangeContent(() =>
        this.refreshDirty(path, entry),
      ),
    };
    this.entries.set(path, entry);
    return entry;
  }

  private flushPath(path: string): void {
    const text = this.queue.get(path);
    if (text === undefined) return;
    this.queue.delete(path);
    const model = this.entries.get(path)?.model;
    if (!model) return;
    // Append at the end; never setValue per token (O(n²), resets the view).
    const line = model.getLineCount();
    const column = model.getLineMaxColumn(line);
    model.applyEdits([
      {
        range: {
          startLineNumber: line,
          startColumn: column,
          endLineNumber: line,
          endColumn: column,
        },
        text,
      },
    ]);
  }

  private restoreOriginal(path: string, e: Entry): void {
    const original = e.stream?.original ?? null;
    if (original === null) {
      this.dispose(path);
      return;
    }
    e.stream = null;
    e.model.setValue(original);
    e.savedAlt = e.model.getAlternativeVersionId();
    this.refreshDirty(path, e);
  }

  private markSaved(
    path: string,
    e: Entry,
    version: number,
    alt: number,
    content: string,
  ): void {
    e.baseVersion = Math.max(e.baseVersion, version);
    e.savedAlt = alt;
    e.savedContent = content;
    e.pendingSave = null;
    e.conflict = null;
    this.refreshDirty(path, e);
  }

  private refreshDirty(path: string, e: Entry): void {
    const dirty =
      e.stream === null && e.model.getAlternativeVersionId() !== e.savedAlt;
    if (dirty === e.dirty) return;
    e.dirty = dirty;
    this.options.onDirtyChange?.(path, dirty);
  }
}
```

- [ ] **Step 3: Run** → PASS. **Commit** — `feat(frontend): add editor models with streaming, dirty tracking and conflicts`

---

### Task FE-5.3: File tree

**Files:**

- Create: `frontend/src/features/workspace/editor/file-tree.ts`, `FileTree.vue`, `FileTreeNode.vue`
- Test: `frontend/tests/features/workspace/editor/file-tree.test.ts`

**Interfaces:** Produces `buildFileTree(paths) → TreeNode[]`, `NodeMarks { active, dirty, streaming, uncommitted }`; `<FileTree :paths :marks @open>`.

- [ ] **Step 1: Failing test**

`frontend/tests/features/workspace/editor/file-tree.test.ts`:

```ts
import { buildFileTree } from "@/features/workspace/editor/file-tree";

describe("buildFileTree", () => {
  it("nests folders, puts index.html first, then folders, then files", () => {
    const tree = buildFileTree([
      "styles.css",
      "js/api.js",
      "index.html",
      "app.js",
      "js/ui/list.js",
    ]);
    expect(tree.map((n) => n.path)).toEqual([
      "index.html",
      "js",
      "app.js",
      "styles.css",
    ]);
    const js = tree[1]!;
    expect(js.children.map((n) => n.path)).toEqual(["js/ui", "js/api.js"]);
    expect(js.children[0]!.children.map((n) => n.name)).toEqual(["list.js"]);
  });
});
```

- [ ] **Step 2: Implement**

`frontend/src/features/workspace/editor/file-tree.ts`:

```ts
import { ENTRY_FILE } from "@/contracts/paths";

export interface TreeNode {
  name: string;
  path: string;
  kind: "folder" | "file";
  children: TreeNode[];
}

function compare(a: TreeNode, b: TreeNode): number {
  if (a.path === ENTRY_FILE) return -1;
  if (b.path === ENTRY_FILE) return 1;
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function sortTree(nodes: TreeNode[]): void {
  nodes.sort(compare);
  for (const node of nodes) sortTree(node.children);
}

/** Flat paths → nested nodes; index.html first, then folders, then files, alphabetically. */
export function buildFileTree(paths: readonly string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", kind: "folder", children: [] };
  for (const path of new Set(paths)) {
    const parts = path.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const kind = i === parts.length - 1 ? "file" : "folder";
      let child = node.children.find((c) => c.name === part && c.kind === kind);
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          kind,
          children: [],
        };
        node.children.push(child);
      }
      node = child;
    });
  }
  sortTree(root.children);
  return root.children;
}
```

`frontend/src/features/workspace/editor/FileTreeNode.vue`:

```vue
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
```

`frontend/src/features/workspace/editor/FileTree.vue`:

```vue
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
```

- [ ] **Step 3: Run** → PASS. **Commit** — `feat(frontend): add file tree`

---

### Task FE-5.4: Code panel, tabs, Monaco editor, status bar

**Files:**

- Create: `frontend/src/features/workspace/editor/EditorTabs.vue`, `CodeEditor.vue`, `EditorStatusBar.vue`, `CodePanel.vue`

**Interfaces:** `CodeEditor` props `{ path, readOnly, follow, theme }`, emits `save`. It swaps models itself and saves/restores view state per file. Because `@guolao/vue-monaco-editor` disposes the attached model on unmount, `CodeEditor` detaches (`setModel(null)`) in `onBeforeUnmount` so unsaved models survive; it also disposes the wrapper's placeholder model on mount.

- [ ] **Step 1: Implement**

`frontend/src/features/workspace/editor/EditorTabs.vue`:

```vue
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
```

`frontend/src/features/workspace/editor/CodeEditor.vue`:

```vue
<script setup lang="ts">
import { VueMonacoEditor } from "@guolao/vue-monaco-editor";
import type * as Monaco from "monaco-editor";
import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import { Spinner } from "@/components/ui/spinner";
import { useWorkspace } from "../workspace-context";
import { setupMonaco } from "./monaco-setup";

const props = defineProps<{
  path: string;
  readOnly: boolean;
  follow: boolean;
  theme: "light" | "dark";
}>();
const emit = defineEmits<{ save: [] }>();

const monaco = setupMonaco();
const { models } = useWorkspace();
const editor = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
let contentListener: Monaco.IDisposable | null = null;

const options = computed<Monaco.editor.IStandaloneEditorConstructionOptions>(
  () => ({
    readOnly: props.readOnly,
    readOnlyMessage: { value: "Read-only while Genesis is generating." },
    minimap: { enabled: false },
    fontSize: 13,
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
    tabSize: 2,
    wordWrap: "on",
    scrollBeyondLastLine: false,
    automaticLayout: true,
    formatOnPaste: false,
    formatOnType: false,
  }),
);

function attach(path: string, previous: string | null): void {
  const instance = editor.value;
  if (!instance) return;
  if (previous) models.saveViewState(previous, instance.saveViewState());
  const model = models.get(path);
  instance.setModel(model);
  const state = models.viewState(path);
  if (model && state) instance.restoreViewState(state);
  contentListener?.dispose();
  // "Follow generation": keep the last streamed line in view.
  contentListener =
    model?.onDidChangeContent(() => {
      if (props.readOnly && props.follow)
        instance.revealLine(model.getLineCount());
    }) ?? null;
}

function onMount(instance: Monaco.editor.IStandaloneCodeEditor): void {
  const placeholder = instance.getModel();
  editor.value = instance;
  instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
    emit("save"),
  );
  attach(props.path, null);
  placeholder?.dispose(); // the wrapper's own empty model
}

watch(
  () => props.path,
  (next, previous) => attach(next, previous),
);

onBeforeUnmount(() => {
  const instance = editor.value;
  if (!instance) return;
  models.saveViewState(props.path, instance.saveViewState());
  contentListener?.dispose();
  // The wrapper disposes whatever model is attached on unmount; ours must survive.
  instance.setModel(null);
});
</script>

<template>
  <VueMonacoEditor
    :theme="props.theme === 'dark' ? 'vs-dark' : 'vs'"
    :options="options"
    @mount="onMount"
  >
    <div class="flex h-full items-center justify-center">
      <Spinner class="text-muted-foreground" />
    </div>
  </VueMonacoEditor>
</template>
```

`frontend/src/features/workspace/editor/EditorStatusBar.vue`:

```vue
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
```

`frontend/src/features/workspace/editor/CodePanel.vue`:

```vue
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
```

- [ ] **Step 2: Verify** — click files in the tree → tabs; edit, switch tabs, switch back → edits and cursor kept; close a dirty tab → "Discard unsaved changes?"; middle-click closes a tab; dark mode switches the editor theme. **Commit** — `feat(frontend): add code panel with tabs and Monaco editor`

---

### Task FE-5.5: Streaming into the editor and remote updates

**Files:**

- Create: `frontend/src/features/workspace/composables/useStreamingEditor.ts`, `useRemoteFileSync.ts`
- Modify: `frontend/src/features/workspace/WorkspacePage.vue` (create `EditorModels`, provide `models`, call both composables — see FE-3.1)

**Interfaces:** Consumes `useGenerationStore().bus`, `EditorModels`, `useWorkspaceStore()`.

- [ ] **Step 1: Implement**

`frontend/src/features/workspace/composables/useStreamingEditor.ts`:

```ts
import { onScopeDispose } from "vue";
import { useGenerationStore } from "../stores/generation.store";
import { useWorkspaceStore } from "../stores/workspace.store";
import { useWorkspace } from "../workspace-context";

/** Pipes streamed file tokens from the generation bus into Monaco models (outside Vue reactivity). */
export function useStreamingEditor(): void {
  const ws = useWorkspace();
  const generation = useGenerationStore();
  const workspace = useWorkspaceStore();

  const offs = [
    generation.bus.on("file-start", ({ path, language }) => {
      ws.models.beginStream(path, language);
      if (workspace.followGeneration) workspace.openFile(path);
    }),
    generation.bus.on("file-delta", ({ path, text }) =>
      ws.models.append(path, text),
    ),
    generation.bus.on("file-end", ({ path, status }) => {
      ws.models.endStream(path, status);
      if (status === "rejected" && !ws.files.value.some((f) => f.path === path))
        workspace.closeFile(path);
    }),
    generation.bus.on("end", ({ outcome }) => {
      ws.models.settleStreams(outcome);
      // Commits can land before the terminal event; re-sync so versions are current.
      for (const file of ws.files.value) ws.models.syncFromRemote(file);
      workspace.retainPaths(ws.files.value.map((f) => f.path));
    }),
  ];
  onScopeDispose(() => offs.forEach((off) => off()));
}
```

`frontend/src/features/workspace/composables/useRemoteFileSync.ts`:

```ts
import { watch } from "vue";
import { useWorkspaceStore } from "../stores/workspace.store";
import { useWorkspace } from "../workspace-context";

/** Applies listener updates (generation commits, restores, saves from other tabs) to open models. */
export function useRemoteFileSync(): void {
  const ws = useWorkspace();
  const workspace = useWorkspaceStore();

  watch(ws.files, (files) => {
    for (const file of files) {
      if (ws.models.syncFromRemote(file) === "conflict")
        workspace.setConflict(file.path, true);
    }
    const alive = new Set([
      ...files.map((f) => f.path),
      ...ws.models.streamingPaths(),
    ]);
    ws.models.retain(alive);
    workspace.retainPaths([...alive]);
  });
}
```

- [ ] **Step 2: Verify** (fake provider) — tokens appear live in the file being written, the tab follows the active file ("Follow" switch), the editor is read-only with the message "Read-only while Genesis is generating."; after completion the versions in the status bar increase and nothing is marked dirty; with `#badjs` the rejected file reverts to its previous content. **Commit** — `feat(frontend): stream generated code into Monaco and apply remote updates`

---

### Task FE-5.6: Manual save and version conflicts

**Files:**

- Create: `frontend/src/services/api/files.api.ts`, `frontend/src/features/workspace/composables/useFileSave.ts`, `frontend/src/features/workspace/editor/SaveConflictDialog.vue`

**Interfaces:** Produces `saveFile(projectId, fileId, { content, expectedVersion }) → FileSaveResult`; `useFileSave() → { save(path), saveAll(), keepMine(path, remoteVersion), useTheirs(path) }`.

- [ ] **Step 1: Implement**

`frontend/src/services/api/files.api.ts`:

```ts
import type { z } from "zod";
import type { FileSaveBody, FileSaveResult } from "@/contracts/api";
import { apiFetch } from "@/lib/http";

export function saveFile(
  projectId: string,
  fileId: string,
  body: z.infer<typeof FileSaveBody>,
): Promise<FileSaveResult> {
  return apiFetch(
    "api",
    `/v1/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`,
    {
      method: "PUT",
      body,
    },
  );
}
```

`frontend/src/features/workspace/composables/useFileSave.ts`:

```ts
import { toast } from "vue-sonner";
import { toUserMessage } from "@/lib/errors";
import { isApiError } from "@/lib/http";
import { saveFile } from "@/services/api/files.api";
import { useWorkspaceStore } from "../stores/workspace.store";
import { useWorkspace } from "../workspace-context";

export interface FileSaveApi {
  save: (path: string) => Promise<boolean>;
  saveAll: () => Promise<boolean>;
  keepMine: (path: string, remoteVersion: number) => Promise<boolean>;
  useTheirs: (path: string) => void;
}

/** Manual save with optimistic concurrency (07 §4.11). State lives in the workspace store. */
export function useFileSave(): FileSaveApi {
  const ws = useWorkspace();
  const workspace = useWorkspaceStore();

  async function save(path: string): Promise<boolean> {
    const file = ws.files.value.find((f) => f.path === path);
    if (!file || !ws.models.isDirty(path)) return true;
    const draft = ws.models.beginSave(path);
    if (!draft) return false;
    workspace.savingPath = path;
    try {
      const result = await saveFile(ws.projectId, file.id, draft);
      ws.models.completeSave(path, result.version);
      toast.success(`Saved ${path}`);
      return true;
    } catch (error) {
      ws.models.abortSave(path);
      if (isApiError(error) && error.code === "FILE_VERSION_CONFLICT") {
        const remoteVersion = Number(
          error.details["currentVersion"] ?? file.version,
        );
        workspace.setConflict(path, true);
        workspace.saveConflict = { path, remoteVersion };
      } else if (isApiError(error) && error.code === "GENERATION_IN_PROGRESS") {
        toast.error("Saving is paused while Genesis is generating.");
      } else {
        toast.error(toUserMessage(error));
      }
      return false;
    } finally {
      workspace.savingPath = null;
    }
  }

  async function saveAll(): Promise<boolean> {
    for (const path of ws.models.dirtyPaths()) {
      if (!(await save(path))) return false;
    }
    return true;
  }

  async function keepMine(
    path: string,
    remoteVersion: number,
  ): Promise<boolean> {
    ws.models.acceptRemoteVersion(path, remoteVersion);
    workspace.setConflict(path, false);
    workspace.saveConflict = null;
    return save(path);
  }

  function useTheirs(path: string): void {
    const file = ws.files.value.find((f) => f.path === path);
    if (file) ws.models.takeRemote(file);
    workspace.setConflict(path, false);
    workspace.saveConflict = null;
  }

  return { save, saveAll, keepMine, useTheirs };
}
```

`frontend/src/features/workspace/editor/SaveConflictDialog.vue`:

```vue
<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed } from "vue";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useFileSave } from "../composables/useFileSave";
import { useWorkspaceStore } from "../stores/workspace.store";

const workspace = useWorkspaceStore();
const { saveConflict } = storeToRefs(workspace);
const saver = useFileSave();
const open = computed(() => saveConflict.value !== null);

function close(value: boolean): void {
  if (!value) workspace.saveConflict = null;
}
</script>

<template>
  <AlertDialog :open="open" @update:open="close">
    <AlertDialogContent v-if="saveConflict">
      <AlertDialogHeader>
        <AlertDialogTitle
          >{{ saveConflict.path }} changed since you started
          editing</AlertDialogTitle
        >
        <AlertDialogDescription>
          A newer version (v{{ saveConflict.remoteVersion }}) was saved by a
          generation, a restore or another tab. Keep your edits and overwrite
          it, or discard your edits and use the latest.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <Button variant="outline" @click="saver.useTheirs(saveConflict.path)"
          >Use the latest</Button
        >
        <Button
          @click="saver.keepMine(saveConflict.path, saveConflict.remoteVersion)"
          >Keep mine</Button
        >
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
```

- [ ] **Step 2: Verify** — Cmd/Ctrl+S → toast "Saved app.js", version +1, preview rebuilds (FE-6); open the project in two tabs, save different edits in each → the second gets "app.js changed since you started editing" with **Keep mine** / **Use the latest**; saving while a generation runs → "Saving is paused while Genesis is generating." **Commit** — `feat(frontend): add manual save with conflict resolution`
