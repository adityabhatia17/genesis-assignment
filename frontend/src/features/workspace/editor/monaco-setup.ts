import { loader } from '@guolao/vue-monaco-editor';
import * as monaco from 'monaco-editor';
// monaco-editor ≥ 0.56 ships an exports map rooted at esm/vs: these are the worker entry points.
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { defineGenesisThemes } from './monaco-theme';

export type Monaco = typeof monaco;

let configured = false;

/** Bundles Monaco locally (no CDN) and wires its workers through Vite. Only the workspace chunk imports this. */
export function setupMonaco(): Monaco {
  if (!configured) {
    globalThis.MonacoEnvironment = {
      getWorker(_workerId: string, label: string): Worker {
        switch (label) {
          case 'css':
          case 'scss':
          case 'less':
            return new CssWorker();
          case 'html':
          case 'handlebars':
          case 'razor':
            return new HtmlWorker();
          case 'json':
            return new JsonWorker();
          case 'javascript':
          case 'typescript':
            return new TsWorker();
          default:
            return new EditorWorker();
        }
      },
    };
    loader.config({ monaco });
    defineGenesisThemes(monaco);
    configured = true;
  }
  return monaco;
}
