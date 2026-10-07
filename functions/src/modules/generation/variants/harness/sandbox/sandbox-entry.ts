import { JSDOM, VirtualConsole } from 'jsdom';

interface Job {
  html: string;
  scenario: string;
}

export interface CallRecord {
  method: string;
  params: Record<string, unknown>;
}

export interface Observation {
  scenario: string;
  error: string | null;
  calls: CallRecord[];
  text: string;
  buttons: string[];
  inputs: number;
  hasImgPayload: boolean;
}

type Win = {
  __genesisCalls?: CallRecord[];
  document: Document;
  addEventListener: (t: string, fn: (e: { message?: string }) => void) => void;
};

function read(dom: JSDOM): Observation {
  const w = dom.window as unknown as Win;
  const text = w.document.body?.textContent ?? '';
  const buttons = [...w.document.querySelectorAll('button, [role="button"]')]
    .map((el) => (el.textContent ?? '').trim())
    .filter(Boolean);
  return {
    scenario: '',
    error: null,
    calls: w.__genesisCalls ?? [],
    text,
    buttons,
    inputs: w.document.querySelectorAll('input, textarea, select').length,
    hasImgPayload: w.document.querySelector('img[src="x"]') !== null,
  };
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 40));
}

async function interact(dom: JSDOM, scenario: string): Promise<void> {
  const doc = (dom.window as unknown as Win).document;
  if (scenario === 'twoPages') {
    const button = [...doc.querySelectorAll('button')].find((el) =>
      /more|load|next/i.test(el.textContent ?? ''),
    );
    button?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();
  }
  if (scenario === 'search') {
    const input = doc.querySelector('input');
    if (input) {
      input.value = 'Ada';
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      await settle();
    }
  }
}

async function run(job: Job): Promise<Observation> {
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err: Error) => errors.push(err.message));
  const dom = new JSDOM(job.html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
  });
  (dom.window as unknown as Win).addEventListener('error', (e) => {
    if (e.message) errors.push(e.message);
  });
  await settle();
  await interact(dom, job.scenario);
  const obs = read(dom);
  obs.scenario = job.scenario;
  obs.error = errors[0] ?? null;
  dom.window.close();
  return obs;
}

process.on('message', (job: Job) => {
  run(job)
    .then((obs) => process.send?.(obs))
    .catch((err: unknown) =>
      process.send?.({
        scenario: job.scenario,
        error: err instanceof Error ? err.message : 'sandbox failed',
        calls: [],
        text: '',
        buttons: [],
        inputs: 0,
        hasImgPayload: false,
      } satisfies Observation),
    )
    .finally(() => process.exit(0));
});
