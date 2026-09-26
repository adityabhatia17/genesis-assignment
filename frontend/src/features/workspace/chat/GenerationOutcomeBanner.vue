<script setup lang="ts">
import { RotateCcwIcon, TriangleAlertIcon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { outcomeTitle } from "../stores/generation.labels";
import { useGenerationStore } from "../stores/generation.store";

const store = useGenerationStore();
const { state, applying, discarding } = storeToRefs(store);

const title = computed(() => outcomeTitle(state.value));
const staged = computed(() => state.value.partial?.stagedPaths.length ?? 0);
const applyable = computed(
  () => state.value.partial?.applyable === true && staged.value > 0,
);
const rejected = computed(() =>
  state.value.status === "completed"
    ? (state.value.result?.rejected ?? [])
    : [],
);
const retryable = computed(
  () =>
    state.value.status === "cancelled" ||
    state.value.error?.retryable !== false,
);
</script>

<template>
  <Alert
    v-if="title"
    variant="destructive"
    class="mx-4 mb-3"
    data-testid="outcome-banner"
  >
    <TriangleAlertIcon />
    <AlertTitle>{{ title }}</AlertTitle>
    <AlertDescription class="flex flex-col gap-2">
      <p v-if="applyable">
        {{ staged }} {{ staged === 1 ? "file was" : "files were" }} completed
        before it stopped: {{ state.partial?.stagedPaths.join(", ") }}.
      </p>
      <div class="flex flex-wrap gap-2">
        <template v-if="applyable">
          <Button
            size="sm"
            :disabled="applying || discarding"
            @click="store.applyPartial()"
          >
            <Spinner v-if="applying" />Apply {{ staged }}
            {{ staged === 1 ? "file" : "files" }}
          </Button>
          <Button
            size="sm"
            variant="outline"
            :disabled="applying || discarding"
            @click="store.discardPartial()"
          >
            <Spinner v-if="discarding" />Discard
          </Button>
        </template>
        <Button
          v-if="retryable"
          size="sm"
          variant="outline"
          :disabled="applying"
          @click="store.retry()"
        >
          <RotateCcwIcon />Retry
        </Button>
        <Button
          v-if="!applyable"
          size="sm"
          variant="ghost"
          @click="store.dismiss()"
          >Dismiss</Button
        >
      </div>
    </AlertDescription>
  </Alert>
  <Alert
    v-else-if="rejected.length"
    class="mx-4 mb-3"
    data-testid="rejected-banner"
  >
    <TriangleAlertIcon class="text-warning" />
    <AlertTitle
      >{{ rejected.length }}
      {{
        rejected.length === 1 ? "file was" : "files were"
      }}
      rejected</AlertTitle
    >
    <AlertDescription>
      <ul class="list-disc pl-4">
        <li v-for="r in rejected" :key="r.path">
          <span class="font-mono">{{ r.path }}</span> —
          {{ r.issues[0]?.message ?? "Invalid file" }}
        </li>
      </ul>
      <Button
        size="sm"
        variant="ghost"
        class="mt-1 -ml-2"
        @click="store.dismiss()"
        >Dismiss</Button
      >
    </AlertDescription>
  </Alert>
</template>
