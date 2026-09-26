import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { createHttpApp } from '../../../src/http/create-http-app.js';
import { defineHandler } from '../../../src/http/define-handler.js';
import { sendData } from '../../../src/http/respond.js';
import { AppError } from '../../../src/shared/app-error.js';
import { createLogger } from '../../../src/shared/logger.js';

function makeApp() {
  const authed = express.Router();
  authed.get('/v1/me', (req, res) => {
    sendData(res, { uid: req.auth?.uid });
  });
  authed.post(
    '/v1/echo',
    defineHandler({ body: z.strictObject({ n: z.number() }) }, (input, _req, res) => {
      sendData(res, { n: input.body.n });
    }),
  );
  authed.get('/v1/boom', () => {
    throw new AppError('FILE_VERSION_CONFLICT', undefined, { currentVersion: 3 });
  });
  return createHttpApp({
    service: 'api',
    version: 'test',
    allowedOrigins: ['https://app.example'],
    logger: createLogger({ test: true }),
    verifyIdToken: async (t) => {
      if (t !== 'good') throw new Error('bad');
      return { uid: 'u1' };
    },
    authedRouters: [authed],
  });
}

describe('createHttpApp', () => {
  it('serves health publicly with a request id', async () => {
    const res = await request(makeApp()).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { ok: true, service: 'api', version: 'test' } });
    expect(res.headers['x-request-id']).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('rejects missing or bad tokens with the error envelope', async () => {
    const res = await request(makeApp()).get('/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'UNAUTHENTICATED', retryable: false });
    expect(res.body.error.requestId).toBeTruthy();
    const bad = await request(makeApp()).get('/v1/me').set('Authorization', 'Bearer nope');
    expect(bad.status).toBe(401);
  });
  it('passes authenticated requests', async () => {
    const res = await request(makeApp()).get('/v1/me').set('Authorization', 'Bearer good');
    expect(res.body).toEqual({ data: { uid: 'u1' } });
  });
  it('maps AppError and zod errors', async () => {
    const boom = await request(makeApp()).get('/v1/boom').set('Authorization', 'Bearer good');
    expect(boom.status).toBe(409);
    expect(boom.body.error).toMatchObject({
      code: 'FILE_VERSION_CONFLICT',
      details: { currentVersion: 3 },
    });
    const invalid = await request(makeApp())
      .post('/v1/echo')
      .set('Authorization', 'Bearer good')
      .send({ n: 'x' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
  });
  it('returns 404 for unknown authenticated routes', async () => {
    const res = await request(makeApp()).get('/v1/nope').set('Authorization', 'Bearer good');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
  it('answers CORS preflight only for allowed origins', async () => {
    const ok = await request(makeApp())
      .options('/v1/me')
      .set('Origin', 'https://app.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.example');
    const denied = await request(makeApp())
      .options('/v1/me')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
