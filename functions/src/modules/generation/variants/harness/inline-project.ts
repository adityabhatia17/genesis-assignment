import { parse, serialize } from 'parse5';
import { ENTRY_FILE } from '../../../../contracts/paths.js';
import { normalizeRef } from '../../validation/html-refs.js';

interface P5Node {
  nodeName: string;
  tagName?: string;
  namespaceURI?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: P5Node[];
  parentNode?: P5Node;
}

export interface ProjectFile {
  path: string;
  content: string;
}

const XHTML = 'http://www.w3.org/1999/xhtml';
const escapeScript = (code: string) => code.replace(/<\/(script)/gi, '<\\/$1');
const escapeStyle = (css: string) => css.replace(/<\/(style)/gi, '<\\/$1');

const attr = (node: P5Node, name: string) => node.attrs?.find((a) => a.name === name)?.value;

function textNode(value: string, parent: P5Node): P5Node {
  return { nodeName: '#text', value, parentNode: parent };
}

/**
 * parse5's serializer ignores an element that has `nodeName` but no `tagName`
 * and no namespace. A hand-built node without both is dropped, which strips
 * the inlined script, the stylesheet and the mock runtime.
 */
function element(name: string, attrs: { name: string; value: string }[], text?: string): P5Node {
  const node: P5Node = {
    nodeName: name,
    tagName: name,
    namespaceURI: XHTML,
    attrs,
    childNodes: [],
  };
  if (text !== undefined) {
    const child = textNode(text, node);
    node.childNodes = [child];
  }
  return node;
}

function replace(node: P5Node, next: P5Node): void {
  const parent = node.parentNode;
  const kids = parent?.childNodes;
  if (!kids) return;
  const i = kids.indexOf(node);
  if (i < 0) return;
  next.parentNode = parent;
  kids[i] = next;
}

function walk(node: P5Node, visit: (n: P5Node) => void): void {
  visit(node);
  for (const child of [...(node.childNodes ?? [])]) walk(child, visit);
}

/**
 * Inlines local CSS and JS the way the preview compiler does, then prepends
 * the mock runtime. Remote resources are dropped.
 */
export function inlineProject(files: readonly ProjectFile[], mock: string): string | null {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const entry = byPath.get(ENTRY_FILE);
  if (entry === undefined) return null;
  const doc = parse(entry) as P5Node;
  const parents = (node: P5Node, parent?: P5Node) => {
    node.parentNode = parent;
    for (const child of node.childNodes ?? []) parents(child, node);
  };
  parents(doc);

  walk(doc, (node) => {
    if (node.nodeName === 'link' && (attr(node, 'rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet')) {
      const href = attr(node, 'href') ?? '';
      const local = normalizeRef(href);
      const css = local ? byPath.get(local) : undefined;
      if (!local || css === undefined) {
        replace(node, element('style', [], ''));
        return;
      }
      replace(node, element('style', [{ name: 'data-genesis-href', value: local }], escapeStyle(css)));
    }
    if (node.nodeName === 'script' && attr(node, 'src') !== undefined) {
      const src = attr(node, 'src') ?? '';
      const local = normalizeRef(src);
      const js = local ? byPath.get(local) : undefined;
      if (!local || js === undefined) {
        replace(node, element('script', [], ''));
        return;
      }
      replace(node, element('script', [{ name: 'data-genesis-src', value: local }], escapeScript(js)));
    }
  });

  const mockNode = element('script', [{ name: 'data-genesis-mock', value: '1' }], mock);
  const html = doc.childNodes?.find((n) => n.nodeName === 'html');
  const head = html?.childNodes?.find((n) => n.nodeName === 'head');
  if (head?.childNodes) {
    mockNode.parentNode = head;
    head.childNodes.unshift(mockNode);
  }
  return serialize(doc as never);
}
