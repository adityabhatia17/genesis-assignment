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
