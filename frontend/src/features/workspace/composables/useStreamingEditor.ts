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
