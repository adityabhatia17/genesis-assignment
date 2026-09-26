import { globalIgnores } from 'eslint/config';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import skipFormatting from 'eslint-config-prettier/flat';
import pluginVue from 'eslint-plugin-vue';

export default defineConfigWithVueTs(
  { name: 'app/files-to-lint', files: ['**/*.{vue,ts,mts}'] },
  globalIgnores([
    '**/dist/**',
    '**/coverage/**',
    'src/components/ui/**',
    'src/contracts/**',
    'src/features/workspace/preview/runtime/**',
    'playwright-report/**',
  ]),
  ...pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommendedTypeChecked,
  {
    name: 'app/rules',
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'vue/block-lang': ['error', { script: { lang: 'ts' } }],
      'vue/component-api-style': ['error', ['script-setup']],
      'vue/define-macros-order': 'error',
      'vue/no-v-html': 'error',
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    name: 'app/tests',
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  skipFormatting,
);
