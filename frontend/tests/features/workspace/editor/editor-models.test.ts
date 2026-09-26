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
