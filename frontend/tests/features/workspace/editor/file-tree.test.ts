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
