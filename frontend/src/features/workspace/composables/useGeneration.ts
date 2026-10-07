import { useEventListener } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { onBeforeUnmount, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { confirmAction } from "@/composables/useConfirm";
import { fetchLatestGeneration } from "@/services/firestore/generations.repo";
import { isActive } from "../stores/generation.reducer";
import { useVariantsStore } from "@/features/variants/stores/variants.store";
import { useGenerationStore } from "../stores/generation.store";
import { useWorkspaceStore } from "../stores/workspace.store";
import { useWorkspace } from "../workspace-context";

/**
 * Binds the generation store to the open project: shows generations started elsewhere or left
 * unresolved (FE-4.6), and protects running generations and unsaved edits when leaving.
 */
export function useGeneration(): void {
  const ws = useWorkspace();
  const store = useGenerationStore();
  const workspace = useWorkspaceStore();
  const { state } = storeToRefs(store);
  store.bindProject(ws.uid, ws.projectId);

  // Page load: a still-running generation, or one that stopped with applyable files.
  let hydrated = false;
  watch(
    () => ws.project.value,
    (project) => {
      if (!project || hydrated) return;
      hydrated = true;
      fetchLatestGeneration(ws.uid, ws.projectId)
        .then((latest) => {
          if (latest)
            store.hydrate(latest, { latestSnapshotId: project.latestSnapshotId ?? null });
        })
        .catch((error: unknown) =>
          console.warn("[generation] could not read the latest generation", error),
        );
    },
    { immediate: true },
  );

  // Another tab (or session) starts generating while this one is open.
  watch(
    () => ws.project.value?.activeGeneration?.id ?? null,
    (id) => {
      if (!id) return;
      store.hydrate({
        id,
        status: "streaming",
        prompt: "",
        error: null,
        partial: null,
        result: null,
        heartbeatAtMs: null,
      });
    },
  );

  onBeforeRouteLeave(async () => {
    if (workspace.dirtyPaths.length > 0) {
      const ok = await confirmAction({
        title: "Leave with unsaved changes?",
        description: `Unsaved edits in ${workspace.dirtyPaths.join(", ")} will be lost.`,
        confirmLabel: "Leave",
        destructive: true,
      });
      if (!ok) return false;
    }
    if (isActive(state.value.status) && state.value.origin === "local") {
      const buildingOptions = state.value.mode === "variants";
      return confirmAction({
        title: buildingOptions ? "Leave while building options?" : "Leave while generating?",
        description: buildingOptions
          ? "Leaving now stops this build. You would need to start again."
          : "The generation continues on the server. If the connection drops, finished files can be applied when you come back.",
        confirmLabel: "Leave",
        destructive: true,
      });
    }
    return true;
  });

  useEventListener(window, "beforeunload", (event: BeforeUnloadEvent) => {
    if (
      workspace.dirtyPaths.length > 0 ||
      (isActive(state.value.status) && state.value.origin === "local")
    ) {
      event.preventDefault();
    }
  });

  onBeforeUnmount(() => {
    useVariantsStore().release();
    store.teardown();
  });
}
