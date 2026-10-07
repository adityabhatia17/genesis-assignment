import { useLocalStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import { ref } from 'vue';

export type MobileTab = 'chat' | 'code' | 'preview';

export interface SaveConflict {
  path: string;
  remoteVersion: number;
}

/** Ephemeral UI state of one open project. Durable data lives in Firestore listeners. */
export const useWorkspaceStore = defineStore('workspace', () => {
  const projectId = ref<string | null>(null);
  const openPaths = ref<string[]>([]);
  const activePath = ref<string | null>(null);
  const dirtyPaths = ref<string[]>([]);
  const conflictPaths = ref<string[]>([]);
  const saveConflict = ref<SaveConflict | null>(null);
  const savingPath = ref<string | null>(null);
  const previewNonce = ref(0);
  const consoleOpen = ref(false);
  const historyOpen = ref(false);
  const mobileTab = ref<MobileTab>('chat');
  /** Set when returning from a discarded variants run so the composer can restore the prompt. */
  const seedPrompt = ref<string | null>(null);
  const followGeneration = useLocalStorage('genesis-follow-generation', true);
  const treeCollapsed = useLocalStorage('genesis-tree-collapsed', false);

  function reset(nextProjectId: string): void {
    projectId.value = nextProjectId;
    openPaths.value = [];
    activePath.value = null;
    dirtyPaths.value = [];
    conflictPaths.value = [];
    saveConflict.value = null;
    savingPath.value = null;
    previewNonce.value = 0;
    consoleOpen.value = false;
    historyOpen.value = false;
    mobileTab.value = 'chat';
    seedPrompt.value = null;
  }

  function openFile(path: string, activate = true): void {
    if (!openPaths.value.includes(path)) openPaths.value = [...openPaths.value, path];
    if (activate) activePath.value = path;
  }

  function closeFile(path: string): void {
    const index = openPaths.value.indexOf(path);
    if (index === -1) return;
    const next = openPaths.value.filter((p) => p !== path);
    openPaths.value = next;
    if (activePath.value === path)
      activePath.value = next[Math.min(index, next.length - 1)] ?? null;
  }

  const toggle = (list: typeof dirtyPaths, path: string, on: boolean): void => {
    const has = list.value.includes(path);
    if (on && !has) list.value = [...list.value, path];
    if (!on && has) list.value = list.value.filter((p) => p !== path);
  };

  /** Drops tabs and flags for files that no longer exist (deleted by a generation or a restore). */
  function retainPaths(existing: readonly string[]): void {
    const keep = new Set(existing);
    for (const path of openPaths.value.filter((p) => !keep.has(p))) closeFile(path);
    dirtyPaths.value = dirtyPaths.value.filter((p) => keep.has(p));
    conflictPaths.value = conflictPaths.value.filter((p) => keep.has(p));
  }

  return {
    projectId,
    openPaths,
    activePath,
    dirtyPaths,
    conflictPaths,
    saveConflict,
    savingPath,
    previewNonce,
    consoleOpen,
    historyOpen,
    mobileTab,
    seedPrompt,
    followGeneration,
    treeCollapsed,
    reset,
    openFile,
    closeFile,
    setDirty: (path: string, dirty: boolean) => toggle(dirtyPaths, path, dirty),
    setConflict: (path: string, on: boolean) => toggle(conflictPaths, path, on),
    retainPaths,
    reloadPreview: () => void (previewNonce.value += 1),
  };
});
