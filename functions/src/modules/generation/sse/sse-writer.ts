import type { Response } from 'express';
import {
  SSE_PROTOCOL_VERSION,
  type GenerationEventData,
  type GenerationEventType,
} from '../../../contracts/sse.js';
import type { Clock } from '../../../shared/clock.js';

export class SseWriter {
  private seq = 0;
  private closed = false;

  constructor(
    private readonly res: Response,
    private readonly generationId: string,
    private readonly clock: Clock,
  ) {
    res.on('close', () => {
      this.closed = true;
    });
  }

  get isClosed(): boolean {
    return this.closed || this.res.writableEnded;
  }

  open(): void {
    this.res.status(200);
    this.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    this.res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
    this.res.setHeader('Connection', 'keep-alive');
    this.res.setHeader('X-Accel-Buffering', 'no');
    this.res.flushHeaders();
    this.res.write(': open\n\n');
  }

  /** Returns false when the event was not written (closed) or the socket asked to drain. */
  send<T extends GenerationEventType>(type: T, data: GenerationEventData<T>): boolean {
    if (this.isClosed) return false;
    this.seq += 1;
    const envelope = {
      v: SSE_PROTOCOL_VERSION,
      seq: this.seq,
      generationId: this.generationId,
      ts: this.clock.now(),
      type,
      data,
    };
    return this.res.write(`event: ${type}\nid: ${this.seq}\ndata: ${JSON.stringify(envelope)}\n\n`);
  }

  heartbeat(): void {
    this.send('heartbeat', {});
  }

  async drain(): Promise<void> {
    if (this.isClosed || !this.res.writableNeedDrain) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        this.res.off('drain', done);
        this.res.off('close', done);
        resolve();
      };
      this.res.once('drain', done);
      this.res.once('close', done);
    });
  }

  end(): void {
    if (!this.res.writableEnded) this.res.end();
    this.closed = true;
  }
}
