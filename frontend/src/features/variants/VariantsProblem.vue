<script setup lang="ts">
import { RotateCcwIcon } from '@lucide/vue';
import PageState from '@/components/common/PageState.vue';
import { Button } from '@/components/ui/button';
import { useVariantsStore } from './stores/variants.store';
import { useGenerationStore } from '@/features/workspace/stores/generation.store';
import { useWorkspaceStore } from '@/features/workspace/stores/workspace.store';
import { PROBLEM_COPY, type ProblemKind } from './variants.labels';

const props = defineProps<{ kind: ProblemKind }>();
const generation = useGenerationStore();
const workspace = useWorkspaceStore();
const copy = PROBLEM_COPY;

function retry(): void {
  generation.retry();
}

async function startOver(): Promise<void> {
  const variants = useVariantsStore();
  if (variants.loadState !== 'idle') {
    await variants.discard();
    return;
  }
  workspace.seedPrompt = generation.state.prompt;
  generation.clear();
}
</script>

<template>
  <section class="flex flex-1 flex-col">
  <PageState kind="error" :title="copy[props.kind].title" :description="copy[props.kind].description" />
  <div class="flex justify-center gap-2 pb-10">
    <Button
      v-if="props.kind === 'expired' || props.kind === 'project_changed'"
      @click="startOver()"
    >
      Start again
    </Button>
    <template v-else>
      <Button @click="retry()"><RotateCcwIcon />Try again</Button>
      <Button v-if="props.kind === 'cancelled'" variant="ghost" @click="generation.dismiss()">
        Dismiss
      </Button>
    </template>
  </div>
  </section>
</template>
