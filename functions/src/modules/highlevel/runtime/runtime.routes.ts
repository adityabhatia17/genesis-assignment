import express, { type RequestHandler, type Router } from 'express';
import { z } from 'zod';
import { DocId } from '../../../contracts/api.js';
import { RUNTIME_METHOD_NAMES, RUNTIME_METHODS } from '../../../contracts/hl-runtime.js';
import { requireUid } from '../../../http/define-handler.js';
import { sendData } from '../../../http/respond.js';
import type { RuntimeService } from './runtime.service.js';

const PathParams = z.object({ projectId: DocId }).catchall(z.string());
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function runtimeRouter(service: Pick<RuntimeService, 'invoke'>): Router {
  const r = express.Router();
  for (const method of RUNTIME_METHOD_NAMES) {
    const spec = RUNTIME_METHODS[method];
    const route = `/v1/projects/:projectId${spec.path}`;
    const handler: RequestHandler = (req, res, next) => {
      void (async () => {
        try {
          const { projectId, ...pathParams } = PathParams.parse(req.params);
          const source: unknown = spec.verb === 'GET' ? req.query : req.body;
          const raw = { ...(isPlainObject(source) ? source : {}), ...pathParams };
          sendData(res, await service.invoke(requireUid(req), projectId, method, raw, req.ctx.log));
        } catch (err) {
          next(err);
        }
      })();
    };
    r.get(route, handler);
  }
  return r;
}
