import { createSharedComposable, useColorMode } from '@vueuse/core';
import { computed, type ComputedRef, type Ref } from 'vue';

export type ThemeMode = 'light' | 'dark' | 'auto';

export const isThemeMode = (value: unknown): value is ThemeMode =>
  value === 'light' || value === 'dark' || value === 'auto';

export interface ThemeApi {
  /** What the user chose (including "auto"). */
  mode: Ref<ThemeMode>;
  /** What is actually applied. */
  resolved: ComputedRef<'light' | 'dark'>;
  setMode: (mode: ThemeMode) => void;
}

function createTheme(): ThemeApi {
  // Same storage key as the pre-paint script in index.html.
  const colorMode = useColorMode({ storageKey: 'genesis-color-scheme', disableTransition: true });
  return {
    mode: colorMode.store,
    resolved: computed(() => colorMode.state.value),
    setMode: (mode) => {
      colorMode.store.value = mode;
    },
  };
}

export const useTheme = createSharedComposable(createTheme);
