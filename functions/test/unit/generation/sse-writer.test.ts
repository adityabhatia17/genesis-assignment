import express from 'express';
import request from 'supertest';
import { GenerationEventSchema } from '../../../src/contracts/sse.js';
import { SseWriter } from '../../../src/modules/generation/sse/sse-writer.js';
import { createFakeClock } from '../../../src/shared/clock.js';
import { parseSse } from '../../helpers/parse-sse.js';

it('frames events with monotonically increasing seq and valid envelopes', async () => {
  const app = express();
  let sentAfterEnd: boolean | undefined;
  app.get('/s', (_req, res) => {
    const w = new SseWriter(res, 'g-1', createFakeClock(1_000));
    w.open();
    w.send('generation.phase', { phase: 'context' });
    w.send('file.delta', { path: 'app.js', text: 'line1\nline2' });
    w.heartbeat();
    w.end();
    sentAfterEnd = w.send('heartbeat', {});
  });
  const res = await request(app).get('/s');
  expect(sentAfterEnd).toBe(false);
  expect(res.headers['content-type']).toContain('text/event-stream');
  expect(res.headers['cache-control']).toContain('no-transform');
  const frames = parseSse(res.text);
  expect(frames.map((f) => [f.event, f.id])).toEqual([
    ['generation.phase', '1'],
    ['file.delta', '2'],
    ['heartbeat', '3'],
  ]);
  for (const f of frames) expect(GenerationEventSchema.safeParse(f.data).success).toBe(true);
  expect((frames[1]!.data as { data: { text: string } }).data.text).toBe('line1\nline2');
});
