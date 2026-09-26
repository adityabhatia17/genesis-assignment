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
