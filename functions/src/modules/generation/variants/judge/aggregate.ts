import { LIMITS } from '../../../../contracts/limits.js';
import type { CandidateScore, ScorePart } from '../../../../contracts/variants.js';
import { GROUP_OF, SCORE_PARTS } from '../../../../contracts/variants.js';

export interface Judgement {
  visual: number;
  clarity: number;
  /** Checklist item id → met. null means the quote did not verify. */
  items: Readonly<Record<string, boolean | null>>;
  status: 'judged' | 'unjudged';
  reason: string | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function groupsOf(parts: NonNullable<CandidateScore['parts']>): CandidateScore['groups'] {
  const acc = { works: 0, looks: 0, request: 0, easy: 0 };
  const max = { works: 0, looks: 0, request: 0, easy: 0 };
  for (const part of SCORE_PARTS) {
    const group = GROUP_OF[part];
    const row = parts[part];
    if (!group || !row) continue;
    acc[group] += row.points;
    max[group] += row.max;
  }
  return {
    works: { points: round1(acc.works), max: max.works },
    looks: { points: round1(acc.looks), max: max.looks },
    request: { points: round1(acc.request), max: max.request },
    easy: { points: round1(acc.easy), max: max.easy },
  };
}

/** Fills the judge share and recomputes the total. Deterministic for the same judgement. */
export function applyJudgement(score: CandidateScore, judged: Judgement): CandidateScore {
  const parts: NonNullable<CandidateScore['parts']> = { ...score.parts };
  const set = (part: ScorePart, judgePoints: number) => {
    const row = parts[part];
    if (!row) return;
    const judge = Math.min(Math.max(judgePoints, 0), row.max - row.det);
    parts[part] = { ...row, judge: round1(judge), points: round1(row.det + judge) };
  };
  if (judged.status === 'unjudged') {
    const visual = parts.visual;
    const clarity = parts.clarity;
    if (visual && visual.max > visual.det) set('visual', (visual.det / Math.max(visual.max - 12, 1)) * 12);
    if (clarity && clarity.max > clarity.det) set('clarity', (clarity.det / Math.max(clarity.max - 6, 1)) * 6);
  } else {
    set('visual', judged.visual);
    set('clarity', judged.clarity);
  }

  const requestRows = score.checklist.filter((row) => row.id.startsWith('R'));
  const judgeRows = requestRows.filter((row) => row.passed === null || row.id in judged.items);
  const share = requestRows.length === 0 ? 0 : Math.min(7.5, (15 * judgeRows.length) / requestRows.length);
  const each = judgeRows.length ? share / judgeRows.length : 0;
  let requestJudge = 0;
  const checklist = score.checklist.map((row) => {
    if (!(row.id in judged.items)) return row;
    const met = judged.status === 'judged' ? judged.items[row.id] : null;
    const points = met === true ? each : 0;
    requestJudge += points;
    return { ...row, passed: met ?? null, points: round1(points), evidence: met === null ? 'unverified' : 'judged' };
  });
  set('request', requestJudge);

  const total = Math.min(100, Math.max(0, Math.round(SCORE_PARTS.reduce((n, p) => n + (parts[p]?.points ?? 0), 0))));
  const gatesPass = score.gates.every((g) => g.passed);
  return {
    ...score,
    total,
    parts,
    groups: groupsOf(parts),
    checklist,
    judge: { status: judged.status, reason: judged.reason },
    eligible: gatesPass && total >= LIMITS.variants.minShownScore,
  };
}
