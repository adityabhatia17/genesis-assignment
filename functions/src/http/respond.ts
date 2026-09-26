import type { Response } from 'express';

export function sendData<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ data });
}
