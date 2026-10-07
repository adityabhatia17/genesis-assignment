import type { z } from 'zod';
import type { TokenUsage } from './model-provider.js';

export interface StructuredRequest<T> {
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxTokens: number;
  signal: AbortSignal;
  timeoutMs: number;
}

export interface StructuredResult<T> {
  data: T;
  usage: TokenUsage;
  model: string;
  repaired: boolean;
}

/** One non-streaming JSON call. Checklist and judge both use this. */
export interface StructuredClient {
  complete<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
}
