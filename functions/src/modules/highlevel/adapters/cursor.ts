import { z } from 'zod';
import { AppError } from '../../../shared/app-error.js';

const CursorSchema = z.discriminatedUnion('k', [
  z.object({
    k: z.literal('contacts'),
    sa: z
      .array(z.union([z.string(), z.number()]))
      .min(1)
      .max(4),
  }),
  z.object({
    k: z.literal('conversations'),
    sad: z.union([z.number(), z.string()]),
  }),
  z.object({ k: z.literal('messages'), lmi: z.string().min(1) }),
]);
export type Cursor = z.infer<typeof CursorSchema>;

export const encodeCursor = (c: Cursor): string =>
  Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');

export function decodeCursor<K extends Cursor['k']>(
  kind: K,
  raw: string,
): Extract<Cursor, { k: K }> {
  try {
    const parsed = CursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    if (parsed.k !== kind) throw new Error('cursor kind mismatch');
    return parsed as Extract<Cursor, { k: K }>;
  } catch (err) {
    throw new AppError('VALIDATION_FAILED', 'Invalid cursor', { field: 'cursor' }, { cause: err });
  }
}
