import { parse } from 'parse5';

interface P5Node {
  nodeName: string;
  attrs?: { name: string; value: string }[];
  childNodes?: P5Node[];
  content?: P5Node; // <template>
}

const isRemote = (ref: string) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref);

/** Local path for a reference relative to index.html, or null if it is remote/empty. */
export function normalizeRef(ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed || isRemote(trimmed)) return null;
  return trimmed.split(/[?#]/)[0]!.replace(/^\.\//, '').replace(/^\//, '');
}

export function extractLocalRefs(html: string): {
  scripts: string[];
  styles: string[];
  remote: string[];
} {
  const out = { scripts: [] as string[], styles: [] as string[], remote: [] as string[] };
  const visit = (node: P5Node) => {
    const attr = (name: string) => node.attrs?.find((a) => a.name === name)?.value;
    if (node.nodeName === 'script') {
      const src = attr('src');
      if (src !== undefined) {
        const local = normalizeRef(src);
        if (local) out.scripts.push(local);
        else if (src.trim()) out.remote.push(src.trim());
      }
    }
    if (
      node.nodeName === 'link' &&
      (attr('rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet')
    ) {
      const href = attr('href');
      if (href !== undefined) {
        const local = normalizeRef(href);
        if (local) out.styles.push(local);
        else if (href.trim()) out.remote.push(href.trim());
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(parse(html));
  return out;
}
