import express, { type Router } from 'express';
import { requireUid } from '../../../http/define-handler.js';
import { sendData } from '../../../http/respond.js';
import type { Clock } from '../../../shared/clock.js';
import type { ConnectionRepo } from './connection.repo.js';

export function connectionRouter(repo: ConnectionRepo, clock: Clock): Router {
  const r = express.Router();
  r.delete('/v1/hl/connection', (req, res, next) => {
    void (async () => {
      try {
        const uid = requireUid(req);
        await repo.deleteConnection(uid, clock.now());
        req.ctx.log.info('hl.disconnect');
        sendData(res, { status: 'disconnected' as const });
      } catch (err) {
        next(err);
      }
    })();
  });
  return r;
}
