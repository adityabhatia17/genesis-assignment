import express, { type Router } from 'express';
import { OAuthCallbackQuery, OAuthStartBody } from '../../../contracts/api.js';
import { defineHandler, requireUid } from '../../../http/define-handler.js';
import { sendData } from '../../../http/respond.js';
import type { OAuthService } from './oauth.service.js';

export function oauthPublicRouter(service: OAuthService): Router {
  const r = express.Router();
  r.get('/v1/hl/oauth/callback', (req, res, next) => {
    void (async () => {
      try {
        const parsed = OAuthCallbackQuery.safeParse(req.query);
        const target = await service.handleCallback(parsed.success ? parsed.data : {});
        res.setHeader('Cache-Control', 'no-store');
        res.redirect(302, target);
      } catch (err) {
        next(err);
      }
    })();
  });
  return r;
}

export function oauthAuthedRouter(service: OAuthService): Router {
  const r = express.Router();
  r.post(
    '/v1/hl/oauth/start',
    defineHandler({ body: OAuthStartBody }, async ({ body }, req, res) => {
      sendData(res, await service.start(requireUid(req), body.returnPath));
    }),
  );
  return r;
}
