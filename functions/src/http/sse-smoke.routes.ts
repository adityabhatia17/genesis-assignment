import express, { type Router } from 'express';

/** Streams 5 events one second apart; proves responses are not buffered end-to-end. */
export function sseSmokeRouter(): Router {
  const r = express.Router();
  r.get('/v1/health/stream', (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    let n = 0;
    const timer = setInterval(() => {
      n += 1;
      res.write(`event: tick\nid: ${n}\ndata: ${JSON.stringify({ n, at: new Date().toISOString() })}\n\n`);
      if (n === 5) {
        clearInterval(timer);
        res.end();
      }
    }, 1_000);
    req.on('close', () => clearInterval(timer));
  });
  return r;
}
