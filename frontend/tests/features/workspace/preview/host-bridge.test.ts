import type { PreviewContext } from '@/contracts/bridge';
import { PreviewHostBridge, type BridgeCall } from '@/features/workspace/preview/host-bridge';
import { ApiError } from '@/lib/http';

const context: PreviewContext = {
  location: null,
  project: { id: 'p1', name: 'P' },
  hlStatus: 'disconnected',
};

function setup(invoke = vi.fn().mockResolvedValue({ items: [] })) {
  let listener: ((e: MessageEvent) => void) | null = null;
  const win = {
    addEventListener: (_t: 'message', fn: (e: MessageEvent) => void) => (listener = fn),
    removeEventListener: () => (listener = null),
  };
  const child = { postMessage: vi.fn() };
  const frame = { contentWindow: child } as unknown as HTMLIFrameElement;
  const port1 = {
    postMessage: vi.fn(),
    onmessage: null as ((e: MessageEvent) => void) | null,
    close: vi.fn(),
  };
  const calls: BridgeCall[] = [];
  const bridge = new PreviewHostBridge({
    getContext: () => context,
    invoke,
    onLog: vi.fn(),
    onCall: (c) => calls.push(c),
    win,
    createChannel: () => ({ port1, port2: {} as Transferable }),
  });
  bridge.attach(() => frame, 'n0nce123');
  const hello = (nonce = 'n0nce123', source: unknown = child) =>
    listener?.({
      source,
      data: { source: 'genesis-preview', type: 'hello', protocol: 1, nonce },
    } as unknown as MessageEvent);
  const rpc = async (method: string, params: unknown, id = 'r1') => {
    port1.onmessage?.({ data: { type: 'rpc', id, method, params } } as MessageEvent);
    await new Promise((r) => setTimeout(r, 0));
    return port1.postMessage.mock.calls.at(-1)?.[0] as Record<string, unknown>;
  };
  return { bridge, child, port1, hello, rpc, calls, invoke };
}

describe('PreviewHostBridge', () => {
  it('hands a port only to its own iframe with the current nonce', () => {
    const { child, hello } = setup();
    hello('n0nce123', {});
    hello('wrong');
    expect(child.postMessage).not.toHaveBeenCalled();
    hello();
    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'init', nonce: 'n0nce123', context }),
      '*',
      [{}],
    );
  });

  it('validates, invokes and answers RPCs', async () => {
    const { hello, rpc, invoke, calls } = setup();
    hello();
    expect(await rpc('contacts.list', { limit: '5' })).toEqual({
      type: 'rpc-result',
      id: 'r1',
      ok: true,
      result: { items: [] },
    });
    expect(invoke).toHaveBeenCalledWith('contacts.list', { limit: 5 }, expect.any(AbortSignal));
    expect(calls[0]).toMatchObject({ method: 'contacts.list', ok: true, code: null });
  });

  it('rejects unknown methods and invalid params without calling the API', async () => {
    const { hello, rpc, invoke } = setup();
    hello();
    expect(await rpc('contacts.deleteAll', {})).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_METHOD' },
    });
    expect(await rpc('calendars.events', { from: 'yesterday', to: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('enforces the in-flight call budget', async () => {
    const pending: Array<() => void> = [];
    const { hello, rpc } = setup(
      vi.fn(
        () =>
          new Promise((resolve) => {
            pending.push(() => resolve({ ok: true }));
          }),
      ),
    );
    hello();
    for (let i = 0; i < 6; i += 1) void rpc('contacts.list', { limit: 1 }, `w${i}`);
    expect(await rpc('contacts.list', { limit: 1 }, 'w6')).toMatchObject({
      ok: false,
      error: { code: 'PREVIEW_LIMIT', retryable: true },
    });
    pending.forEach((release) => release());
  });

  it('passes API errors through as { code, message, retryable }', async () => {
    const { hello, rpc } = setup(
      vi.fn().mockRejectedValue(
        new ApiError({
          code: 'HL_REAUTH_REQUIRED',
          message: 'Your HighLevel connection expired — reconnect.',
          status: 409,
          retryable: false,
        }),
      ),
    );
    hello();
    expect(await rpc('location.get', {})).toMatchObject({
      ok: false,
      error: { code: 'HL_REAUTH_REQUIRED', retryable: false },
    });
  });
});
