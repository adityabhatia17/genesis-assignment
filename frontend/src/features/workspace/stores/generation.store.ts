import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { toast } from 'vue-sonner';
import { LIMITS } from '@/contracts/limits';
import type { GenerationEvent } from '@/contracts/sse';
import { toUserMessage } from '@/lib/errors';
import { isApiError } from '@/lib/http';
import { newId } from '@/lib/ids';
import { streamGeneration } from '@/services/api/generation-stream';
import { applyGeneration, discardGeneration } from '@/services/api/generations.api';
import { watchGeneration } from '@/services/firestore/generations.repo';
import { createGenerationBus } from './generation-bus';
import {
  initialGenerationState,
  isActive,
  isTerminal,
  reduceGeneration,
  type GenerationAction,
  type GenerationSnapshot,
  type GenerationState,
} from './generation.reducer';

export const MISSING_DOC_GRACE_MS = 5_000;
/** Server lease staleness (60 s) plus a margin for client clock skew. */
export const STALE_AFTER_MS = LIMITS.staleLeaseMs + 30_000;
export const STALE_CHECK_MS = 15_000;

export const useGenerationStore = defineStore('generation', () => {
  const state = shallowRef<GenerationState>(initialGenerationState());
  const applying = ref(false);
  const discarding = ref(false);
  const bus = createGenerationBus();

  let uid: string | null = null;
  let projectId: string | null = null;
  let streamAbort: AbortController | null = null;
  let stopWatching: (() => void) | null = null;
  const handledIds = new Set<string>();

  const status = computed(() => state.value.status);
  const active = computed(() => isActive(state.value.status));

  function dispatch(action: GenerationAction): void {
    const prev = state.value;
    const next = reduceGeneration(prev, action);
    if (next === prev) return;
    state.value = next;
    if (isTerminal(next.status) && !isTerminal(prev.status))
      bus.emit('end', { outcome: next.status });
  }

  function onStreamEvent(event: GenerationEvent): void {
    const before = state.value.lastSeq;
    dispatch({ type: 'event', event, at: Date.now() });
    if (state.value.lastSeq === before) return; // ignored: foreign, duplicate or late
    if (event.type === 'file.started')
      bus.emit('file-start', {
        path: event.data.path,
        language: event.data.language,
      });
    else if (event.type === 'file.delta') bus.emit('file-delta', event.data);
    else if (event.type === 'file.completed')
      bus.emit('file-end', {
        path: event.data.path,
        status: event.data.status,
      });
  }

  function project(): { uid: string; projectId: string } {
    if (!uid || !projectId) throw new Error('Generation store is not bound to a project');
    return { uid, projectId };
  }

  function bindProject(nextUid: string, nextProjectId: string): void {
    if (uid === nextUid && projectId === nextProjectId) return;
    teardown();
    uid = nextUid;
    projectId = nextProjectId;
  }

  /** Leaving the workspace: closing the stream makes the server finish the generation as interrupted. */
  function teardown(): void {
    streamAbort?.abort();
    streamAbort = null;
    stopWatching?.();
    stopWatching = null;
    handledIds.clear();
    state.value = initialGenerationState();
    uid = null;
    projectId = null;
  }

  async function start(prompt: string): Promise<void> {
    const { projectId: pid } = project();
    if (active.value) return;
    const generationId = newId(); // doubles as clientRequestId (idempotency key)
    handledIds.add(generationId);
    dispatch({ type: 'submit', generationId, prompt, at: Date.now() });
    const controller = new AbortController();
    streamAbort = controller;
    try {
      const outcome = await streamGeneration({
        projectId: pid,
        clientRequestId: generationId,
        prompt,
        signal: controller.signal,
        onEvent: onStreamEvent,
        onInvalidEvent: (sample) => console.warn('[generation] ignored invalid SSE event', sample),
      });
      const stillCurrent = state.value.generationId === generationId;
      if (stillCurrent && !outcome.terminal && outcome.reason !== 'aborted') {
        dispatch({ type: 'stream-lost' });
        reconcile(generationId);
      }
    } catch (error) {
      if (state.value.generationId === generationId) handleStartError(error, generationId);
    } finally {
      if (streamAbort === controller) streamAbort = null;
    }
  }

  function handleStartError(error: unknown, generationId: string): void {
    const code = isApiError(error) ? error.code : null;
    switch (code) {
      case 'GENERATION_IN_PROGRESS': {
        const activeId = isApiError(error) ? error.details['activeGenerationId'] : undefined;
        toast.info('A generation is already running for this project.');
        if (typeof activeId === 'string') attach(activeId, '');
        else dispatch({ type: 'reset' });
        return;
      }
      case 'DUPLICATE_REQUEST':
      case 'NETWORK':
      case 'TIMEOUT':
        // The request may have reached the server: the generation document decides.
        dispatch({ type: 'stream-lost' });
        reconcile(generationId);
        return;
      case 'ABORTED':
        dispatch({ type: 'reset' });
        return;
      default:
        toast.error(toUserMessage(error));
        dispatch({ type: 'reset' });
    }
  }

  function attach(generationId: string, prompt: string): void {
    handledIds.add(generationId);
    dispatch({ type: 'attach', generationId, prompt, at: Date.now() });
    reconcile(generationId);
  }

  /** Follows the persisted generation document until it reaches a terminal status. */
  function reconcile(generationId: string): void {
    const { uid: u, projectId: pid } = project();
    stopWatching?.();
    let latest: GenerationSnapshot | null = null;
    let missingTimer: ReturnType<typeof setTimeout> | null = null;
    let finalizeRequested = false;
    let stopped = false;
    let unsubscribe: (() => void) | null = null;

    const cleanup = (): void => {
      stopped = true;
      unsubscribe?.();
      clearInterval(staleTimer);
      if (missingTimer) clearTimeout(missingTimer);
      if (stopWatching === cleanup) stopWatching = null;
    };

    // A generation whose heartbeat stopped belongs to a dead instance: the next
    // start/apply treats the lease as stale and finalizes it as interrupted (07 §4.8).
    const checkStale = (): void => {
      const snapshot = latest;
      if (!snapshot || snapshot.status !== 'streaming' || finalizeRequested) return;
      if (snapshot.heartbeatAtMs === null || Date.now() - snapshot.heartbeatAtMs <= STALE_AFTER_MS)
        return;
      finalizeRequested = true;
      dispatch({
        type: 'reconciled',
        snapshot: {
          ...snapshot,
          status: 'interrupted',
          error: null,
          partial: snapshot.partial,
        },
      });
    };
    const staleTimer = setInterval(checkStale, STALE_CHECK_MS);
    stopWatching = cleanup;

    unsubscribe = watchGeneration(u, pid, generationId, {
      next: (snapshot) => {
        if (!snapshot) {
          missingTimer ??= setTimeout(() => {
            cleanup();
            toast.error("Couldn't start the generation. Check your connection and try again.");
            dispatch({ type: 'reset' });
          }, MISSING_DOC_GRACE_MS);
          return;
        }
        if (missingTimer) {
          clearTimeout(missingTimer);
          missingTimer = null;
        }
        latest = snapshot;
        dispatch({ type: 'reconciled', snapshot });
        if (isTerminal(state.value.status) || state.value.generationId !== generationId) cleanup();
        else checkStale();
      },
      error: (error) => toast.error(toUserMessage(error)),
    });
    if (stopped) unsubscribe();
  }

  async function applyPartial(): Promise<void> {
    const { projectId: pid } = project();
    const { generationId, partial } = state.value;
    if (!generationId || !partial?.applyable || applying.value) return;
    applying.value = true;
    try {
      const result = await applyGeneration(pid, generationId);
      dispatch({ type: 'partial-applied', result });
      const n = result.appliedPaths.length + result.deletedPaths.length;
      toast.success(
        `Applied ${n} file change${n === 1 ? '' : 's'} · Snapshot #${result.snapshotSeq}`,
      );
    } catch (error) {
      const issues = isApiError(error) ? error.details['issues'] : undefined;
      const first = Array.isArray(issues)
        ? (issues[0] as { message?: unknown } | undefined)
        : undefined;
      const detail = typeof first?.message === 'string' ? ` ${first.message}` : '';
      toast.error(`${toUserMessage(error)}${detail}`);
    } finally {
      applying.value = false;
    }
  }

  async function discardPartial(): Promise<void> {
    const { projectId: pid } = project();
    const { generationId } = state.value;
    if (!generationId || discarding.value) return;
    discarding.value = true;
    try {
      await discardGeneration(pid, generationId);
      dispatch({ type: 'reset' });
      toast.success('Discarded the unfinished files.');
    } catch (error) {
      toast.error(toUserMessage(error));
    } finally {
      discarding.value = false;
    }
  }

  function retry(): void {
    const prompt = state.value.prompt;
    if (!prompt || active.value) return;
    dispatch({ type: 'reset' });
    void start(prompt);
  }

  function dismiss(): void {
    if (isTerminal(state.value.status)) dispatch({ type: 'reset' });
  }

  /**
   * Called with the project's latest generation (page load) or its activeGeneration (another tab).
   * Shows running generations and unresolved partial results; ignores everything else.
   */
  function hydrate(snapshot: GenerationSnapshot): void {
    if (state.value.status !== 'idle' || handledIds.has(snapshot.id)) return;
    if (snapshot.status === 'streaming') {
      attach(snapshot.id, snapshot.prompt);
      return;
    }
    if (snapshot.status === 'completed' || !snapshot.partial?.applyable) return;
    handledIds.add(snapshot.id);
    dispatch({
      type: 'attach',
      generationId: snapshot.id,
      prompt: snapshot.prompt,
      at: Date.now(),
    });
    dispatch({ type: 'reconciled', snapshot });
  }

  return {
    state,
    status,
    active,
    applying,
    discarding,
    bus,
    bindProject,
    teardown,
    start,
    applyPartial,
    discardPartial,
    retry,
    dismiss,
    hydrate,
  };
});
