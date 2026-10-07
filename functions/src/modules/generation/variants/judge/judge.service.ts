import { createHash } from 'node:crypto';
import { LIMITS } from '../../../../contracts/limits.js';
import type { Checklist } from '../../../../contracts/variants.js';
import type { TokenUsage } from '../../llm/model-provider.js';
import type { StructuredClient } from '../../llm/structured-client.js';
import type { ProjectFile } from '../harness/inline-project.js';
import { applyJudgement, type Judgement } from './aggregate.js';
import { verifyQuotes } from './evidence.js';
import { JUDGE_PROMPT_VERSION, JUDGE_SYSTEM } from './judge-prompt.v1.js';
import { JudgeResultSchema, type JudgeResult } from './judge.schema.js';
import type { CandidateScore } from '../../../../contracts/variants.js';

const LABELS = ['A', 'B', 'C', 'D'] as const;

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(runId: string, salt: number): number {
  const hex = createHash('sha256').update(`${runId}:${salt}`).digest('hex').slice(0, 8);
  return Number.parseInt(hex, 16);
}

function shuffle<T>(items: readonly T[], rnd: () => number): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    const a = next[i]!;
    next[i] = next[j]!;
    next[j] = a;
  }
  return next;
}

export interface JudgeCandidate {
  candidateId: string;
  files: readonly ProjectFile[];
  score: CandidateScore;
}

function sourceOf(files: readonly ProjectFile[]): string {
  const joined = files.map((f) => `===== ${f.path}\n${f.content}`).join('\n');
  return joined.slice(0, LIMITS.variants.judgeSourceBudgetBytes);
}

function renderUser(options: { label: string; source: string }[], checklist: Checklist): string {
  const items = checklist.items
    .filter((item) => item.check.type === 'judge')
    .map((item) => `- ${item.id}: ${item.text}`)
    .join('\n');
  const blocks = options.map((o) => `<option label="${o.label}">\n${o.source}\n</option>`).join('\n\n');
  return `<checklist>\n${items || '(no open items)'}\n</checklist>\n\n${blocks}`;
}

const scale = (score: number, max: number) => ((score - 1) / 4) * max;

function pointsOf(result: JudgeResult, label: string, itemIds: readonly string[]): { visual: number; clarity: number; items: Record<string, boolean | null> } | null {
  const option = result.options.find((o) => o.label === label);
  if (!option) return null;
  const items: Record<string, boolean | null> = {};
  for (const id of itemIds) items[id] = option.items.find((item) => item.id === id)?.met ?? null;
  return { visual: scale(option.visual.score, 12), clarity: scale(option.clarity.score, 6), items };
}

/**
 * Two shuffled passes. A wide disagreement drops the judge and keeps the
 * objective-tracking value. A failed call leaves every candidate unjudged.
 */
export class JudgeService {
  constructor(
    private readonly client: StructuredClient,
    private readonly model: string,
  ) {}

  async judge(i: {
    runId: string;
    checklist: Checklist;
    candidates: readonly JudgeCandidate[];
    signal: AbortSignal;
  }): Promise<{ scores: CandidateScore[]; notice: 'unjudged' | null; usage: TokenUsage | null }> {
    const itemIds = i.checklist.items.filter((item) => item.check.type === 'judge').map((item) => item.id);
    try {
      const first = await this.pass(i, 1);
      const second = await this.pass(i, 2);
      return {
        scores: i.candidates.map((c) => {
          const a = this.lookup(first.verified, first.order, c.candidateId, itemIds);
          const b = this.lookup(second.verified, second.order, c.candidateId, itemIds);
          if (!a || !b) return applyJudgement(c.score, { visual: 0, clarity: 0, items: {}, status: 'unjudged', reason: 'missing option' });
          const gap = Math.abs(a.visual + a.clarity - (b.visual + b.clarity));
          const judgement: Judgement =
            gap > LIMITS.variants.judgeDisagreementMax
              ? { visual: 0, clarity: 0, items: {}, status: 'unjudged', reason: 'disagreement' }
              : {
                  visual: (a.visual + b.visual) / 2,
                  clarity: (a.clarity + b.clarity) / 2,
                  items: averageItems(a.items, b.items),
                  status: 'judged',
                  reason: null,
                };
          return applyJudgement(c.score, judgement);
        }),
        notice: null,
        usage: addUsage(first.usage, second.usage),
      };
    } catch {
      return {
        scores: i.candidates.map((c) =>
          applyJudgement(c.score, { visual: 0, clarity: 0, items: {}, status: 'unjudged', reason: 'judge failed' }),
        ),
        notice: 'unjudged',
        usage: null,
      };
    }
  }

  private lookup(result: JudgeResult, order: readonly { candidateId: string; label: string }[], candidateId: string, itemIds: readonly string[]) {
    const label = order.find((o) => o.candidateId === candidateId)?.label;
    return label ? pointsOf(result, label, itemIds) : null;
  }

  private async pass(
    i: { runId: string; checklist: Checklist; candidates: readonly JudgeCandidate[]; signal: AbortSignal },
    salt: number,
  ) {
    const order = shuffle(i.candidates, mulberry32(seedOf(i.runId, salt))).map((c, index) => ({
      candidateId: c.candidateId,
      label: LABELS[index] ?? 'D',
      source: sourceOf(c.files),
    }));
    const result = await this.client.complete({
      model: this.model,
      system: JUDGE_SYSTEM,
      user: renderUser(order, i.checklist),
      schema: JudgeResultSchema,
      schemaName: 'judge',
      maxTokens: 4_000,
      signal: i.signal,
      timeoutMs: LIMITS.variants.judgeTimeoutMs,
    });
    const source = order.map((o) => o.source).join('\n');
    return { verified: verifyQuotes(result.data, source), order, usage: result.usage };
  }
}

function averageItems(a: Record<string, boolean | null>, b: Record<string, boolean | null>): Record<string, boolean | null> {
  const out: Record<string, boolean | null> = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const left = a[id];
    const right = b[id];
    if (left === true && right === true) out[id] = true;
    else if (left === false && right === false) out[id] = false;
    else out[id] = null;
  }
  return out;
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
  };
}

export { JUDGE_PROMPT_VERSION };
