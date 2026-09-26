import { FileStreamParser } from '../../../src/modules/generation/protocol/file-stream-parser.js';
import { FakeProvider } from '../../../src/modules/generation/llm/fake.provider.js';
import {
  DEMO_APP_JS,
  DEMO_INDEX_HTML,
  DEMO_STYLES_CSS,
} from '../../../src/modules/generation/llm/fake-scripts.js';
import { validateWrite } from '../../../src/modules/generation/validation/validate-file.js';
import {
  applyOps,
  validateProject,
} from '../../../src/modules/generation/validation/validate-project.js';

async function collect(tag: string) {
  const p = new FakeProvider().stream({
    system: [],
    messages: [{ role: 'user', content: `<request>\n${tag}\n</request>` }],
    signal: new AbortController().signal,
  });
  const parser = new FileStreamParser();
  const events = [];
  for await (const e of p) if (e.type === 'text_delta') events.push(...parser.push(e.text));
  events.push(...parser.finish());
  return { events, final: await p.final() };
}

describe('fake provider', () => {
  it('demo app is valid end to end', () => {
    const ops = [
      validateWrite('index.html', DEMO_INDEX_HTML),
      validateWrite('styles.css', DEMO_STYLES_CSS),
      validateWrite('app.js', DEMO_APP_JS),
    ];
    for (const r of ops) expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const tree = applyOps(
      new Map(),
      ops.map((r) => r.op!),
    );
    expect(validateProject(tree).filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('default script yields three files', async () => {
    const { events } = await collect('build a dashboard');
    expect(
      events.filter((e) => e.type === 'file_end').map((e) => (e as { path: string }).path),
    ).toEqual(['index.html', 'styles.css', 'app.js']);
  });
  it('truncate script ends mid-file with max_tokens', async () => {
    const { events, final } = await collect('#truncate');
    expect(events.at(-1)).toMatchObject({ type: 'file_abort', path: 'app.js' });
    expect(final.stopReason).toBe('max_tokens');
  });
  it('error script throws after the first file', async () => {
    await expect(collect('#error')).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });
  });
});
