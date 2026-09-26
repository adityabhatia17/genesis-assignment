import { RUNTIME_METHOD_NAMES } from '@/contracts/hl-runtime';
import runtimeSource from '@/features/workspace/preview/runtime/genesis-runtime.js?raw';

interface FakePort {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage: ((e: { data: unknown }) => void) | null;
}

/** Evaluates the runtime against a fake iframe window whose parent records postMessage calls. */
function boot(nonce = 'n0nce123') {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const parent = { postMessage: vi.fn() };
  const logs: unknown[][] = [];
  const win: Record<string, unknown> = {
    __GENESIS_NONCE__: nonce,
    parent,
    console: {
      log: (...a: unknown[]) => logs.push(a),
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    addEventListener: (type: string, fn: (e: unknown) => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type: string, fn: (e: unknown) => void) =>
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((f) => f !== fn),
      ),
  };
  // Evaluating the shipped runtime text is the point of this test (it runs as inline script in the iframe).
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('window', runtimeSource)(win);
  const port: FakePort = { postMessage: vi.fn(), onmessage: null };
  const init = (data: Record<string, unknown>, source: unknown = parent) =>
    (listeners.get('message') ?? []).forEach((fn) => fn({ source, data, ports: [port] }));
  const context = {
    location: { id: 'loc', name: 'Demo Clinic', timezone: 'UTC' },
    project: { id: 'p1', name: 'P' },
    hlStatus: 'connected',
  };
  const handshake = () =>
    init({ source: 'genesis-host', type: 'init', protocol: 1, nonce, context });
  const genesis = win['genesis'] as {
    ready: Promise<void>;
    context: unknown;
    highlevel: Record<string, Record<string, (p?: unknown) => Promise<unknown>>>;
    on: (n: string, h: (p: unknown) => void) => () => void;
  };
  return { win, parent, port, init, handshake, genesis, listeners, logs };
}

describe('genesis runtime v1', () => {
  it('says hello with its nonce and hides the nonce from app code', () => {
    const { parent, win } = boot();
    expect(parent.postMessage).toHaveBeenCalledWith(
      { source: 'genesis-preview', type: 'hello', protocol: 1, nonce: 'n0nce123' },
      '*',
    );
    expect(win['__GENESIS_NONCE__']).toBeUndefined();
  });

  it('exposes exactly the manifest methods on a frozen, non-writable global', () => {
    const { win, genesis } = boot();
    const names = Object.entries(genesis.highlevel).flatMap(([area, methods]) =>
      Object.keys(methods).map((m) => `${area}.${m}`),
    );
    expect(names.sort()).toEqual([...RUNTIME_METHOD_NAMES].sort());
    expect(Object.isFrozen(genesis)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(win, 'genesis')).toMatchObject({
      writable: false,
      configurable: false,
    });
  });

  it('ignores init from the wrong source or with the wrong nonce', async () => {
    const { init, genesis } = boot();
    init({ source: 'genesis-host', type: 'init', protocol: 1, nonce: 'n0nce123', context: {} }, {});
    init({ source: 'genesis-host', type: 'init', protocol: 1, nonce: 'wrong', context: {} });
    const settled = await Promise.race([
      genesis.ready.then(() => 'ready'),
      new Promise((r) => setTimeout(() => r('pending'), 10)),
    ]);
    expect(settled).toBe('pending');
  });

  it('queues calls until ready, then resolves and rejects over the port', async () => {
    const { handshake, port, genesis } = boot();
    const pending = genesis.highlevel['contacts']!['list']!({ limit: 5 });
    handshake();
    await genesis.ready;
    await Promise.resolve();
    const rpc = port.postMessage.mock.calls.find(
      ([m]) => (m as { type: string }).type === 'rpc',
    )![0] as { id: string; method: string; params: unknown };
    expect(rpc).toMatchObject({ method: 'contacts.list', params: { limit: 5 } });
    port.onmessage!({
      data: {
        type: 'rpc-result',
        id: rpc.id,
        ok: true,
        result: { items: [], nextCursor: null, hasMore: false },
      },
    });
    await expect(pending).resolves.toEqual({ items: [], nextCursor: null, hasMore: false });

    const failing = genesis.highlevel['contacts']!['get']!({ contactId: 'c1' });
    await Promise.resolve();
    await Promise.resolve();
    const second = port.postMessage.mock.calls.at(-1)![0] as { id: string };
    port.onmessage!({
      data: {
        type: 'rpc-result',
        id: second.id,
        ok: false,
        error: { code: 'HL_NOT_FOUND', message: 'Not found', retryable: false },
      },
    });
    await expect(failing).rejects.toMatchObject({
      name: 'GenesisError',
      code: 'HL_NOT_FOUND',
      retryable: false,
    });
    expect(genesis.context).toEqual({
      location: { id: 'loc', name: 'Demo Clinic', timezone: 'UTC' },
      project: { id: 'p1', name: 'P' },
    });
  });

  it('mirrors console output and shims storage', async () => {
    const { win, handshake, port, genesis } = boot();
    (win['console'] as { log: (...a: unknown[]) => void }).log('hello', { a: 1 });
    const storage = win['localStorage'] as Storage;
    storage.setItem('k', 'v');
    expect(storage.getItem('k')).toBe('v');
    handshake();
    await genesis.ready;
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'console',
      level: 'log',
      args: ['hello', '{"a":1}'],
    });
  });

  it('rejects event subscriptions while webhooks are out of v1', () => {
    const { genesis } = boot();
    expect(() => genesis.on('contact.created', () => undefined)).toThrow(TypeError);
    expect(() => genesis.on('nope', () => undefined)).toThrow(TypeError);
  });
});
