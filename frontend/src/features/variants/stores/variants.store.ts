import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import { toast } from 'vue-sonner';
import type { RankedEntry } from '@/contracts/variants';
import { toUserMessage } from '@/lib/errors';
import { isApiError } from '@/lib/http';
import { discardGeneration } from '@/services/api/generations.api';
import { getVariantsResult, selectCandidate } from '@/services/api/variants.api';
import { fetchCandidateOps } from '@/services/firestore/variants.repo';
import type { PreviewFile } from '@/features/workspace/preview/compile-preview';
import { useGenerationStore } from '@/features/workspace/stores/generation.store';
import { useWorkspaceStore } from '@/features/workspace/stores/workspace.store';
import { overlayOps } from '../candidate-files';
import { defaultOptionId } from '../option-label';
import { DOUBLE_CHECK_BEFORE_SELECT } from '../variants.labels';

export interface OptionView {
  entry: RankedEntry;
  files: PreviewFile[] | null;
  state: 'loading' | 'ready' | 'error' | 'expired';
}

export interface SelectionConfirmation {
  candidateId: string;
  label: string;
  total: number;
  rank: number;
  snapshotSeq: number;
  files: PreviewFile[] | null;
}

interface LoadInput {
  uid: string;
  projectId: string;
  generationId: string;
  baseFiles: readonly PreviewFile[];
  top: readonly RankedEntry[] | null;
}

export const useVariantsStore = defineStore('variants', () => {
  const options = shallowRef<OptionView[]>([]);
  const selectedId = ref<string | null>(null);
  const loadState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const blocked = ref<null | 'project_changed' | 'expired' | 'unavailable'>(null);
  const selecting = ref<string | null>(null);
  const pendingId = ref<string | null>(null);
  const discarding = ref(false);
  const confirmation = shallowRef<SelectionConfirmation | null>(null);
  const handoffPending = ref(false);
  let context: LoadInput | null = null;
  let loadedFor: string | null = null;

  function patchOption(index: number, patch: Partial<OptionView>): void {
    const next = options.value.slice();
    const current = next[index];
    if (!current) return;
    next[index] = { ...current, ...patch };
    options.value = next;
  }

  function release(): void {
    options.value = [];
    selectedId.value = null;
    confirmation.value = null;
    blocked.value = null;
    pendingId.value = null;
    selecting.value = null;
    discarding.value = false;
    loadState.value = 'idle';
    handoffPending.value = false;
    loadedFor = null;
    context = null;
  }

  async function loadOne(input: LoadInput, entry: RankedEntry, index: number): Promise<void> {
    try {
      const ops = await fetchCandidateOps(
        input.uid,
        input.projectId,
        input.generationId,
        entry.candidateId,
      );
      if (ops.length === 0) {
        patchOption(index, { state: 'expired', files: null });
        return;
      }
      patchOption(index, { state: 'ready', files: overlayOps(input.baseFiles, ops) });
    } catch {
      patchOption(index, { state: 'error', files: null });
    }
  }

  async function load(input: LoadInput): Promise<void> {
    if (loadedFor === input.generationId && loadState.value === 'ready') return;
    context = input;
    loadState.value = 'loading';
    blocked.value = null;
    let top = input.top;
    try {
      if (!top || top.length === 0) {
        const result = await getVariantsResult(input.projectId, input.generationId);
        top = result.top;
        if (top.length > 0) useGenerationStore().showVariants(top, result.notice);
      }
    } catch (error) {
      loadState.value = 'error';
      toast.error(toUserMessage(error));
      return;
    }
    if (!top || top.length === 0) {
      loadState.value = 'error';
      return;
    }
    options.value = top.map((entry) => ({ entry, files: null, state: 'loading' }));
    if (!selectedId.value || !top.some((entry) => entry.candidateId === selectedId.value)) {
      selectedId.value = defaultOptionId(top);
    }
    await Promise.all(top.map((entry, index) => loadOne(input, entry, index)));
    if (options.value.length > 0 && options.value.every((option) => option.state === 'expired')) {
      blocked.value = 'expired';
    }
    loadState.value = options.value.some((option) => option.state !== 'error') ? 'ready' : 'error';
    loadedFor = input.generationId;
  }

  async function reload(): Promise<void> {
    const input = context;
    if (!input) return;
    loadedFor = null;
    await load(input);
  }

  async function retryOption(candidateId: string): Promise<void> {
    const input = context;
    const index = options.value.findIndex((option) => option.entry.candidateId === candidateId);
    const option = options.value[index];
    if (!input || !option) return;
    patchOption(index, { state: 'loading', files: null });
    await loadOne(input, option.entry, index);
  }

  function choose(candidateId: string): void {
    if (pendingId.value || selecting.value || discarding.value || blocked.value) return;
    if (!options.value.some((option) => option.entry.candidateId === candidateId)) return;
    selectedId.value = candidateId;
  }

  function beginSelect(candidateId?: string): void {
    const id = candidateId ?? selectedId.value;
    if (!id || selecting.value || discarding.value || blocked.value) return;
    if (!DOUBLE_CHECK_BEFORE_SELECT) {
      void confirmSelect(id);
      return;
    }
    pendingId.value = id;
  }

  function cancelPending(): void {
    if (selecting.value) return;
    pendingId.value = null;
  }

  async function confirmSelect(candidateId?: string): Promise<void> {
    const id = candidateId ?? pendingId.value;
    const input = context;
    if (!id || !input || selecting.value || discarding.value) return;
    selecting.value = id;
    const option = options.value.find((item) => item.entry.candidateId === id) ?? null;
    try {
      const result = await selectWithRetry(input.projectId, input.generationId, id);
      confirmation.value = {
        candidateId: id,
        label: option ? `Option ${option.entry.rank}` : 'Your version',
        total: option?.entry.total ?? 0,
        rank: option?.entry.rank ?? 0,
        snapshotSeq: result.snapshotSeq,
        files: option?.files ?? null,
      };
      options.value = option ? [{ ...option }] : [];
      useGenerationStore().markSelected(result);
    } catch (error) {
      await handleSelectError(error, input);
    } finally {
      selecting.value = null;
      pendingId.value = null;
    }
  }

  async function discard(): Promise<void> {
    const input = context;
    if (!input || discarding.value || selecting.value) return;
    discarding.value = true;
    const prompt = useGenerationStore().state.prompt;
    try {
      await discardGeneration(input.projectId, input.generationId);
      useWorkspaceStore().seedPrompt = prompt;
      release();
      useGenerationStore().clear();
      toast.success('Discarded the options.');
    } catch (error) {
      toast.error(toUserMessage(error));
      discarding.value = false;
    }
  }

  function requestHandoff(): void {
    handoffPending.value = true;
  }

  function finishHandoff(): void {
    const workspace = useWorkspaceStore();
    release();
    useGenerationStore().clear();
    workspace.openFile('index.html');
    workspace.mobileTab = 'preview';
  }

  return {
    options,
    selectedId,
    loadState,
    blocked,
    selecting,
    pendingId,
    discarding,
    confirmation,
    handoffPending,
    load,
    reload,
    retryOption,
    choose,
    beginSelect,
    cancelPending,
    confirmSelect,
    discard,
    requestHandoff,
    finishHandoff,
    release,
  };
});

async function selectWithRetry(projectId: string, generationId: string, candidateId: string) {
  try {
    return await selectCandidate(projectId, generationId, candidateId);
  } catch (error) {
    if (isApiError(error) && (error.code === 'NETWORK' || error.code === 'TIMEOUT')) {
      return selectCandidate(projectId, generationId, candidateId);
    }
    throw error;
  }
}

async function handleSelectError(error: unknown, input: LoadInput): Promise<void> {
  const store = useVariantsStore();
  if (!isApiError(error)) {
    toast.error(toUserMessage(error));
    return;
  }
  if (error.code === 'CANDIDATE_NOT_SELECTABLE' && error.details['reason'] === 'project_changed') {
    store.blocked = 'project_changed';
    return;
  }
  if (error.code === 'CANDIDATE_NOT_SELECTABLE' || error.code === 'CANDIDATE_NOT_FOUND') {
    store.blocked = 'expired';
    return;
  }
  if (error.code === 'GENERATION_IN_PROGRESS') {
    toast.error('Another generation is running for this project.');
    return;
  }
  if (error.code === 'GENERATION_NOT_AWAITING_SELECTION') {
    try {
      const result = await getVariantsResult(input.projectId, input.generationId);
      if (result.resolution === 'selected' && result.selectedCandidateId) {
        const option =
          store.options.find((item) => item.entry.candidateId === result.selectedCandidateId) ??
          null;
        store.confirmation = {
          candidateId: result.selectedCandidateId,
          label: option ? `Option ${option.entry.rank}` : 'Your version',
          total: option?.entry.total ?? 0,
          rank: option?.entry.rank ?? 0,
          snapshotSeq: 0,
          files: option?.files ?? null,
        };
        useGenerationStore().clear();
        return;
      }
    } catch {
      // Fall through to a reset.
    }
    toast.error(toUserMessage(error));
    store.release();
    useGenerationStore().clear();
    return;
  }
  toast.error(toUserMessage(error));
}
