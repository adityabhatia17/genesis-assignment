<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import PageState from '@/components/common/PageState.vue';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { confirmAction } from '@/composables/useConfirm';
import { useGenerationStore } from '@/features/workspace/stores/generation.store';
import OptionToggle from './OptionToggle.vue';
import ScoreSummary from './ScoreSummary.vue';
import SelectDoubleCheck from './SelectDoubleCheck.vue';
import VariantsProblem from './VariantsProblem.vue';
import VariantsProgress from './VariantsProgress.vue';
import { useVariantsStore } from './stores/variants.store';
import { problemKind, type ProblemKind } from './variants.labels';

const generation = useGenerationStore();
const variants = useVariantsStore();
const { state } = storeToRefs(generation);
const { options, selectedId, loadState, pendingId, selecting, discarding, blocked } =
  storeToRefs(variants);

const building = computed(() =>
  ['submitting', 'streaming', 'reconciling', 'cancelling'].includes(state.value.status),
);

const kind = computed((): ProblemKind | null => {
  if (blocked.value === 'project_changed') return 'project_changed';
  if (blocked.value === 'expired' || blocked.value === 'unavailable') return 'expired';
  return problemKind(state.value);
});

const selected = computed(
  () => options.value.find((option) => option.entry.candidateId === selectedId.value) ?? null,
);

const toggleOptions = computed(() =>
  options.value.map((option) => ({
    candidateId: option.entry.candidateId,
    rank: option.entry.rank,
    total: option.entry.total,
    topPick: option.entry.topPick,
  })),
);

const locked = computed(() => pendingId.value !== null || selecting.value !== null);
const heading = computed(() =>
  options.value.length === 1 ? 'One option is ready.' : 'Choose from the two.',
);

async function startOver(): Promise<void> {
  const ok = await confirmAction({
    title: 'Start over?',
    description: 'These options will be removed. You can describe the app again.',
    confirmLabel: 'Start over',
    destructive: true,
  });
  if (ok) await variants.discard();
}
</script>

<template>
  <div class="flex flex-col gap-3 px-1" data-testid="variants-chat">
    <p class="text-[11px] font-medium text-muted-foreground">Genesis</p>
    <VariantsProblem v-if="kind" :kind="kind" />
    <VariantsProgress v-else-if="building" />
    <template v-else-if="state.status === 'awaiting_selection'">
      <p class="text-sm">{{ heading }}</p>
      <PageState
        v-if="loadState === 'loading' && options.length === 0"
        kind="loading"
        title="Loading options"
      />
      <PageState
        v-else-if="loadState === 'error'"
        kind="error"
        title="Couldn't load the options"
        action-label="Retry"
        @action="variants.reload()"
      />
      <template v-else>
        <OptionToggle
          :options="toggleOptions"
          :selected-id="selectedId"
          :locked="locked"
          @select="variants.choose"
        />
        <ScoreSummary
          v-if="selected"
          :total="selected.entry.total"
          :groups="selected.entry.groups"
        />
        <p v-if="selected?.state === 'loading'" class="text-xs text-muted-foreground">
          Loading this version in the preview.
        </p>
        <p v-else-if="selected && selected.state !== 'ready'" class="text-xs">
          Couldn't load this version.
          <Button
            size="xs"
            variant="outline"
            @click="variants.retryOption(selected.entry.candidateId)"
          >
            Retry
          </Button>
        </p>
        <SelectDoubleCheck
          v-if="pendingId && selected"
          :total="selected.entry.total"
          :busy="selecting === selected.entry.candidateId"
          @confirm="variants.confirmSelect()"
          @back="variants.cancelPending()"
        />
        <div v-else class="flex flex-wrap gap-2">
          <Button
            size="sm"
            :disabled="locked || discarding || selected?.state !== 'ready'"
            @click="variants.beginSelect()"
          >
            <Spinner v-if="selecting" />
            Use this version
          </Button>
          <Button
            size="sm"
            variant="ghost"
            :disabled="discarding || selecting !== null"
            @click="startOver()"
          >
            Start over
          </Button>
        </div>
      </template>
    </template>
  </div>
</template>
