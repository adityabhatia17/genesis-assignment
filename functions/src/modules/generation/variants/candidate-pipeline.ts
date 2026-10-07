import { LIMITS } from '../../../contracts/limits.js';
import type { Clock } from '../../../shared/clock.js';
import { sleep } from '../../../shared/async.js';
import type { CandidateRunner } from '../candidate/candidate-runner.js';
import type { CandidateSink } from '../candidate/candidate-sink.js';
import type { ChatTurn, CurrentFile, SystemBlock } from '../context/render-context.js';
import type { TokenUsage } from '../llm/model-provider.js';
import type { FileOp } from '../validation/validate-file.js';
import type { Tree } from '../validation/validate-project.js';
import type { VariantsRepo } from './variants.repo.js';

export interface CandidateDraft {
  candidateId: string;
  index: number;
  direction: { id: string; label: string; instruction: string };
  files: { path: string; content: string }[];
  usage: TokenUsage | null;
  model: string | null;
  failed: boolean;
}

const ZERO: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

const add = (a: TokenUsage | null, b: TokenUsage | null): TokenUsage | null => {
  if (!a && !b) return null;
  const left = a ?? ZERO;
  const right = b ?? ZERO;
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadInputTokens: left.cacheReadInputTokens + right.cacheReadInputTokens,
    cacheCreationInputTokens: left.cacheCreationInputTokens + right.cacheCreationInputTokens,
  };
};

export async function runOneCandidate(i: {
  repo: VariantsRepo;
  runner: CandidateRunner;
  clock: Clock;
  uid: string;
  pid: string;
  gid: string;
  candidateId: string;
  index: number;
  direction: { id: string; label: string; instruction: string };
  system: SystemBlock[];
  messages: ChatTurn[];
  currentFiles: Map<string, CurrentFile>;
  currentTree: Tree;
  signal: AbortSignal;
  startedAt: number;
  onStage: (stage: 'generating' | 'retrying' | 'validating' | 'done' | 'failed', filesDone?: number) => void;
}): Promise<CandidateDraft> {
  const expireAt = i.startedAt + LIMITS.variants.candidateTtlDays * 24 * 60 * 60 * 1000;
  await i.repo.initCandidate(i.uid, i.pid, i.gid, i.candidateId, i.direction, i.index, expireAt);
  let usage: TokenUsage | null = null;
  let model: string | null = null;
  let attempt = 0;
  let messages = i.messages;

  while (attempt < 2) {
    attempt += 1;
    if (attempt === 2 && i.clock.now() - i.startedAt > LIMITS.variants.retryStartLatestMs) break;
    i.onStage(attempt === 1 ? 'generating' : 'retrying');
    await i.repo.patchCandidate(i.uid, i.pid, i.gid, i.candidateId, {
      status: attempt === 1 ? 'generating' : 'retrying',
      attempts: attempt,
      startedAt: Timestampish(i.clock.now()),
    });
    const ops: FileOp[] = [];
    const sink: CandidateSink = {
      stage: async (op, warnings) => {
        ops.push(op);
        await i.repo.stageFile(i.uid, i.pid, i.gid, i.candidateId, op, warnings, i.clock.now(), expireAt);
      },
    };
    const ran = await i.runner.run(
      {
        system: [
          ...i.system,
          { text: `Design direction — ${i.direction.label}.\n${i.direction.instruction}`, cache: false },
        ],
        messages,
        currentFiles: i.currentFiles,
        currentTree: i.currentTree,
        signal: i.signal,
      },
      sink,
    );
    usage = add(usage, ran.final?.usage ?? null);
    model = ran.final?.model ?? model;
    const writes = ops.filter((op) => op.op === 'write');
    const retryable =
      writes.length === 0 &&
      (ran.termination === 'provider_error' || ran.final?.stopReason === 'max_tokens' || ran.rejected.length > 0);
    if (!retryable || attempt === 2) {
      const failed = writes.length === 0;
      i.onStage(failed ? 'failed' : 'done', writes.length);
      await i.repo.patchCandidate(i.uid, i.pid, i.gid, i.candidateId, {
        status: failed ? 'failed' : 'generated',
        fileCount: writes.length,
        completedAt: Timestampish(i.clock.now()),
        stopReason: ran.final?.stopReason ?? ran.termination,
        usage: usage ?? null,
      });
      return {
        candidateId: i.candidateId,
        index: i.index,
        direction: i.direction,
        files: writes.map((op) => ({ path: op.path, content: op.op === 'write' ? op.content : '' })),
        usage,
        model,
        failed,
      };
    }
    messages = [
      ...i.messages,
      { role: 'user', content: 'The previous answer was not valid. Return the files again, and include index.html.' },
    ];
    await sleep(0);
  }

  i.onStage('failed');
  return {
    candidateId: i.candidateId,
    index: i.index,
    direction: i.direction,
    files: [],
    usage,
    model,
    failed: true,
  };
}

const Timestampish = (ms: number) => new Date(ms);
