import type * as Monaco from 'monaco-editor';

/** Monaco themes from the design hex column. Comments use faint-foreground. */
export function defineGenesisThemes(monaco: typeof Monaco): void {
  monaco.editor.defineTheme('genesis-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6f6e68' },
      { token: 'keyword', foreground: '215da5' },
      { token: 'string', foreground: '346c42' },
      { token: 'number', foreground: '94582a' },
      { token: 'type', foreground: '00686c' },
    ],
    colors: {
      'editor.background': '#fcfcfb',
      'editor.foreground': '#1a1a19',
      'editorLineNumber.foreground': '#6f6e68',
      'editorLineNumber.activeForeground': '#57564f',
      'editor.selectionBackground': '#e4f0ff',
      'editorCursor.foreground': '#2e64a6',
    },
  });
  monaco.editor.defineTheme('genesis-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '85847d' },
      { token: 'keyword', foreground: '85b4f0' },
      { token: 'string', foreground: '87c293' },
      { token: 'number', foreground: 'e3b47d' },
      { token: 'type', foreground: '76c7cc' },
    ],
    colors: {
      'editor.background': '#121211',
      'editor.foreground': '#ececea',
      'editorLineNumber.foreground': '#85847d',
      'editorLineNumber.activeForeground': '#a6a59f',
      'editor.selectionBackground': '#202f42',
      'editorCursor.foreground': '#79a7e2',
    },
  });
}
