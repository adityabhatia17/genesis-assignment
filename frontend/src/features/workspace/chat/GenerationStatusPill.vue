<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { phaseLabel } from "../stores/generation.labels";
import { useGenerationStore } from "../stores/generation.store";

const { state } = storeToRefs(useGenerationStore());
const label = computed(() => phaseLabel(state.value));
</script>

<template>
  <div aria-live="polite" class="contents">
    <Badge v-if="label" variant="secondary" class="gap-1.5 font-normal">
      <Spinner class="size-3" />{{ label }}
    </Badge>
  </div>
</template>
