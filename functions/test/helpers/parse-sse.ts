export interface SseFrame {
  event: string;
  id: string;
  data: unknown;
}

export function parseSse(text: string): SseFrame[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim() && !block.startsWith(':'))
    .map((block) => {
      const lines = block.split('\n');
      const get = (k: string) =>
        lines.find((l) => l.startsWith(`${k}: `))?.slice(k.length + 2) ?? '';
      return { event: get('event'), id: get('id'), data: JSON.parse(get('data')) as unknown };
    });
}
