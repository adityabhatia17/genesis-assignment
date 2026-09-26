import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'happy-dom',
      environmentOptions: {
        happyDOM: {
          settings: {
            disableJavaScriptFileLoading: true,
            disableCSSFileLoading: true,
            disableIframePageLoading: true,
            handleDisabledFileLoadingAsSuccess: true,
          },
        },
      },
      globals: true,
      include: ['tests/**/*.test.ts'],
      exclude: [...configDefaults.exclude, 'e2e/**'],
      setupFiles: ['tests/setup.ts'],
      restoreMocks: true,
      root: fileURLToPath(new URL('./', import.meta.url)),
    },
  }),
);
