import type { ChatTurn, SystemBlock } from '../context/render-context.js';

export type { ChatTurn, SystemBlock };

export type ProviderEvent =
  { type: 'thinking_delta'; text: string } | { type: 'text_delta'; text: string };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface ProviderResult {
  stopReason: string | null;
  usage: TokenUsage;
  model: string;
}

export interface ModelStream extends AsyncIterable<ProviderEvent> {
  final(): Promise<ProviderResult>;
}

export interface ModelProvider {
  readonly name: 'anthropic' | 'fake';
  readonly model: string;
  readonly effort: string;
  stream(input: { system: SystemBlock[]; messages: ChatTurn[]; signal: AbortSignal }): ModelStream;
}

export class ProviderError extends Error {
  constructor(
    readonly code: 'LLM_RATE_LIMITED' | 'LLM_UNAVAILABLE' | 'INTERNAL',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ProviderError';
  }
}

const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/** USD per the published per-MTok prices; cache reads 0.1×, cache writes 1.25× input. */
export function estimateCostUsd(model: string, u: TokenUsage): number {
  const p = PRICES[model];
  if (!p) return 0;
  const cost =
    (u.inputTokens * p.input +
      u.cacheReadInputTokens * p.input * 0.1 +
      u.cacheCreationInputTokens * p.input * 1.25 +
      u.outputTokens * p.output) /
    1_000_000;
  return Math.round(cost * 10_000) / 10_000;
}
