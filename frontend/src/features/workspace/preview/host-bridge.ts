import {
  BRIDGE_PROTOCOL_VERSION,
  HelloMessageSchema,
  PortInboundSchema,
  type HostEventMessage,
  type InitMessage,
  type PreviewContext,
  type RpcErrorPayload,
  type RpcResultMessage,
} from '@/contracts/bridge';
import { defaultMessage } from '@/contracts/errors';
import {
  RUNTIME_METHODS,
  RUNTIME_METHOD_NAMES,
  type RuntimeEventName,
  type RuntimeMethodName,
} from '@/contracts/hl-runtime';
import { LIMITS } from '@/contracts/limits';
import { toUserMessage } from '@/lib/errors';
import { isApiError } from '@/lib/http';

export interface BridgeCall {
  id: string;
  method: string;
  ms: number;
  ok: boolean;
  code: string | null;
  at: number;
}

export interface BridgeLog {
  level: 'log' | 'info' | 'warn' | 'error';
  text: string;
  at: number;
}

interface PortLike {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
}

interface WindowLike {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

export interface HostBridgeDeps {
  getContext: () => PreviewContext;
  invoke: (
    method: RuntimeMethodName,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<unknown>;
  onLog: (entry: BridgeLog) => void;
  onCall: (call: BridgeCall) => void;
  now?: () => number;
  win?: WindowLike;
  createChannel?: () => { port1: PortLike; port2: Transferable };
}

const MINUTE = 60_000;
const isMethod = (m: string): m is RuntimeMethodName =>
  (RUNTIME_METHOD_NAMES as readonly string[]).includes(m);
const rpcError = (code: string, message: string, retryable = false): RpcErrorPayload => ({
  code,
  message,
  retryable,
});

/**
 * The host side of preview bridge protocol v1 (07 §3.3). The iframe gets capabilities, never
 * credentials: every call is allow-listed, schema-checked and budgeted here, then made with the
 * user's ID token by the SPA.
 */
export class PreviewHostBridge {
  private frame: (() => HTMLIFrameElement | null) | null = null;
  private nonce: string | null = null;
  private port: PortLike | null = null;
  private inFlight = 0;
  private calls: number[] = [];
  private writes: number[] = [];
  private readonly controllers = new Set<AbortController>();
  private readonly listener = (event: MessageEvent): void => this.onWindowMessage(event);

  constructor(private readonly deps: HostBridgeDeps) {}

  private get now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private get win(): WindowLike {
    return this.deps.win ?? window;
  }

  /** Call before the iframe document loads; the frame is resolved lazily at handshake time. */
  attach(frame: () => HTMLIFrameElement | null, nonce: string): void {
    this.detach();
    this.frame = frame;
    this.nonce = nonce;
    this.win.addEventListener('message', this.listener);
  }

  detach(): void {
    this.win.removeEventListener('message', this.listener);
    this.port?.close();
    this.port = null;
    this.frame = null;
    this.nonce = null;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.inFlight = 0;
  }

  /** Bonus: forwards HighLevel webhook events to `genesis.on(...)` handlers. */
  pushEvent(name: RuntimeEventName, payload: Record<string, unknown>): void {
    const message: HostEventMessage = { type: 'event', name, payload };
    this.port?.postMessage(message);
  }

  private onWindowMessage(event: MessageEvent): void {
    const frame = this.frame?.();
    if (!frame || this.port || event.source !== frame.contentWindow || !this.nonce) return;
    const hello = HelloMessageSchema.safeParse(event.data);
    if (!hello.success || hello.data.nonce !== this.nonce) return;

    const channel = this.deps.createChannel?.() ?? new MessageChannel();
    const port: PortLike = channel.port1;
    this.port = port;
    port.onmessage = (message: MessageEvent) => void this.onPortMessage(message.data);
    const init: InitMessage = {
      source: 'genesis-host',
      type: 'init',
      protocol: BRIDGE_PROTOCOL_VERSION,
      nonce: this.nonce,
      context: this.deps.getContext(),
    };
    frame.contentWindow?.postMessage(init, '*', [channel.port2]);
  }

  private async onPortMessage(data: unknown): Promise<void> {
    const parsed = PortInboundSchema.safeParse(data);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === 'console') {
      this.deps.onLog({ level: message.level, text: message.args.join(' '), at: this.now });
      return;
    }
    if (message.type === 'runtime-error') {
      this.deps.onLog({
        level: 'error',
        text: message.stack ? `${message.message}\n${message.stack}` : message.message,
        at: this.now,
      });
      return;
    }
    await this.handleRpc(message.id, message.method, message.params);
  }

  private budgetError(write: boolean): RpcErrorPayload | null {
    const now = this.now;
    this.calls = this.calls.filter((t) => t > now - MINUTE);
    this.writes = this.writes.filter((t) => t > now - MINUTE);
    const over =
      this.inFlight >= LIMITS.bridgeMaxInFlight ||
      this.calls.length >= LIMITS.bridgeCallsPerMinute ||
      (write && this.writes.length >= LIMITS.bridgeWritesPerMinute);
    if (over) return rpcError('PREVIEW_LIMIT', defaultMessage('PREVIEW_LIMIT'), true);
    this.calls.push(now);
    if (write) this.writes.push(now);
    return null;
  }

  private async handleRpc(id: string, method: string, params: unknown): Promise<void> {
    const port = this.port;
    const started = this.now;
    const finish = (result: RpcResultMessage): void => {
      if (this.port === port) port?.postMessage(result); // drop replies for a replaced document
      this.deps.onCall({
        id,
        method,
        ms: this.now - started,
        ok: result.ok,
        code: result.ok ? null : result.error.code,
        at: started,
      });
    };
    const fail = (error: RpcErrorPayload): void =>
      finish({ type: 'rpc-result', id, ok: false, error });

    if (!isMethod(method))
      return fail(rpcError('UNKNOWN_METHOD', defaultMessage('UNKNOWN_METHOD')));
    let size: number;
    try {
      size = JSON.stringify(params ?? {}).length;
    } catch {
      return fail(rpcError('VALIDATION_FAILED', 'Parameters must be plain data.'));
    }
    if (size > LIMITS.bridgeMaxParamsBytes)
      return fail(rpcError('VALIDATION_FAILED', 'Parameters are too large.'));
    const spec = RUNTIME_METHODS[method];
    const valid = spec.params.safeParse(params ?? {});
    if (!valid.success) {
      const issue = valid.error.issues[0];
      const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
      return fail(
        rpcError('VALIDATION_FAILED', `${where}${issue?.message ?? 'Invalid parameters.'}`),
      );
    }
    const over = this.budgetError(spec.write);
    if (over) return fail(over);

    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), LIMITS.bridgeCallTimeoutMs);
    this.inFlight += 1;
    try {
      const result = await this.deps.invoke(method, valid.data, controller.signal);
      finish({ type: 'rpc-result', id, ok: true, result });
    } catch (error) {
      if (controller.signal.aborted)
        fail(rpcError('PREVIEW_TIMEOUT', defaultMessage('PREVIEW_TIMEOUT'), true));
      else if (isApiError(error)) fail(rpcError(error.code, toUserMessage(error), error.retryable));
      else fail(rpcError('INTERNAL', defaultMessage('INTERNAL'), true));
    } finally {
      clearTimeout(timer);
      this.inFlight = Math.max(0, this.inFlight - 1);
      this.controllers.delete(controller);
    }
  }
}
