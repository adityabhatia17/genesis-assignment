import { storeToRefs } from 'pinia';
import { watch } from 'vue';
import { useWorkspace } from '@/features/workspace/workspace-context';
import { useGenerationStore } from '@/features/workspace/stores/generation.store';
import { useVariantsStore } from './stores/variants.store';

/** Loads scored options into the chat without replacing the workspace layout. */
export function useVariantsSession(): void {
  const ws = useWorkspace();
  const generation = useGenerationStore();
  const variants = useVariantsStore();
  const { state } = storeToRefs(generation);
  const { confirmation } = storeToRefs(variants);

  watch(
    () =>
      [
        state.value.status,
        state.value.generationId,
        state.value.variants?.top?.length ?? 0,
      ] as const,
    () => {
      if (state.value.status === 'submitting' && confirmation.value) {
        variants.release();
        return;
      }
      if (state.value.status !== 'awaiting_selection') return;
      const generationId = state.value.generationId;
      if (!generationId || confirmation.value) return;
      void variants.load({
        uid: ws.uid,
        projectId: ws.projectId,
        generationId,
        baseFiles: ws.files.value,
        top: state.value.variants?.top ?? null,
      });
    },
  );
}
