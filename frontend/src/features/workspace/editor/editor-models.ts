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
