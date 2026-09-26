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
