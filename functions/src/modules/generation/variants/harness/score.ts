import { LIMITS } from '../../../../contracts/limits.js';
import { mapWithConcurrency } from '../../../../shared/async.js';
import type { Checklist, ChecklistItem, ScorePart } from '../../../../contracts/variants.js';
import { GROUP_OF, SCORE_GROUPS, SCORE_PARTS, SCORE_WEIGHTS, type CandidateScore, type ScoreGroup } from '../../../../contracts/variants.js';
import { ENTRY_FILE } from '../../../../contracts/paths.js';
import { FIXTURE_A, FIXTURE_B, rows } from './fixtures.js';
import { evaluateGates } from './gates.js';
import { inlineProject, type ProjectFile } from './inline-project.js';
import { mockScript, type ScenarioMode } from './mock-genesis.js';
import { evalProbe } from './probes.js';
import { runInSandbox } from './sandbox/run-in-sandbox.js';
import type { Observation } from './sandbox/sandbox-entry.js';
import { staticChecks } from './static-checks.js';

const round1 = (n: number) => Math.round(n * 10) / 10;

function scenariosFor(checklist: Checklist): string[] {
  const names = ['data', 'dataB', 'empty', 'error', 'adversarial', 'loading'];
  if (checklist.items.some((item) => item.check.type === 'probe' && item.check.probe.probe === 'loadMoreAppends')) {
    names.push('twoPages');
  }
  if (checklist.items.some((item) => item.check.type === 'probe' && item.check.probe.probe === 'searchCallsWith')) {
    names.push('search');
  }
  if (checklist.appType === 'list') names.push('rows100');
  return names;
}

async function observe(files: readonly ProjectFile[], scenario: string): Promise<Observation> {
  const mode: ScenarioMode =
    scenario === 'empty' || scenario === 'error' || scenario === 'loading' || scenario === 'adversarial'
      ? scenario
      : 'data';
  const fixture = scenario === 'dataB' ? FIXTURE_B : FIXTURE_A;
  const html = inlineProject(
    files,
    mockScript({
      mode,
      fixture,
      ...(scenario === 'rows100' || scenario === 'twoPages' ? { contactCount: scenario === 'rows100' ? 100 : rows(25).length } : {}),
    }),
  );
  if (!html) {
    return { scenario, error: 'no entry', calls: [], text: '', buttons: [], inputs: 0, hasImgPayload: false };
  }
  const obs = await runInSandbox(html, scenario);
  return { ...obs, scenario };
}

interface PartDraft {
  det: number;
  judge: number;
  max: number;
  judgeMax: number;
}

const emptyParts = (): Record<ScorePart, PartDraft> =>
  Object.fromEntries(SCORE_PARTS.map((p) => [p, { det: 0, judge: 0, max: SCORE_WEIGHTS[p], judgeMax: 0 }])) as Record<
    ScorePart,
    PartDraft
  >;

function groupsOf(parts: Record<ScorePart, PartDraft>): CandidateScore['groups'] {
  const acc: Record<ScoreGroup, { points: number; max: number }> = {
    works: { points: 0, max: 0 },
    looks: { points: 0, max: 0 },
    request: { points: 0, max: 0 },
    easy: { points: 0, max: 0 },
  };
  for (const part of SCORE_PARTS) {
    const group = GROUP_OF[part];
    if (!group) continue;
    acc[group].points += parts[part].det + parts[part].judge;
    acc[group].max += parts[part].max;
  }
  return {
    works: { points: round1(acc.works.points), max: acc.works.max },
    looks: { points: round1(acc.looks.points), max: acc.looks.max },
    request: { points: round1(acc.request.points), max: acc.request.max },
    easy: { points: round1(acc.easy.points), max: acc.easy.max },
  };
}

function itemPoints(item: ChecklistItem, passed: boolean | null, detEach: number, judgeEach: number): number {
  if (item.check.type === 'judge') return passed === true ? judgeEach : 0;
  return passed ? detEach : 0;
}

/** Runs the sandbox and returns a score with the judge share still empty. */
export async function scoreCandidate(
  files: readonly ProjectFile[],
  checklist: Checklist,
): Promise<CandidateScore> {
  const runs = await mapWithConcurrency(scenariosFor(checklist), 3, (scenario) => observe(files, scenario));

  const gates = evaluateGates({ hasEntry: files.some((f) => f.path === ENTRY_FILE), runs });
  const report = staticChecks(files, runs.every((r) => r.error === null || r.scenario === 'error'));
  const parts = emptyParts();
  parts.visual.det = report.visualDet;
  parts.visual.judgeMax = 12;
  parts.clarity.det = report.clarityDet;
  parts.clarity.judgeMax = 6;
  parts.a11y.det = report.a11y;
  parts.robustness.det = report.robustness;

  const requestItems = checklist.items.filter((item) => item.source !== 'baseline');
  const judgeItems = requestItems.filter((item) => item.check.type === 'judge');
  const probeItems = requestItems.filter((item) => item.check.type === 'probe');
  const judgeShare =
    requestItems.length === 0 ? 0 : Math.min(7.5, (15 * judgeItems.length) / requestItems.length);
  const detShare = 15 - judgeShare;
  parts.request.judgeMax = judgeShare;
  const detEach = probeItems.length ? detShare / probeItems.length : 0;
  const judgeEach = judgeItems.length ? judgeShare / judgeItems.length : 0;

  const stateItems = checklist.items.filter(
    (item) => item.check.type === 'probe' && item.check.probe.probe.startsWith('state.'),
  );
  const stateEach = stateItems.length ? 15 / stateItems.length : 0;

  const dataItems = requestItems.filter(
    (item) => item.check.type === 'probe' && (item.check.probe.probe === 'rendersFields' || item.check.probe.probe === 'calls'),
  );
  const dataEach = dataItems.length ? 20 / dataItems.length : 0;

  const checklistRows = checklist.items.map((item) => {
    if (item.check.type === 'judge') {
      return { id: item.id, passed: null as boolean | null, points: 0, evidence: 'waiting for the judge' };
    }
    const hit = evalProbe(item.check.probe, runs);
    let points = 0;
    if (item.check.probe.probe.startsWith('state.')) {
      points = hit.passed ? stateEach : 0;
      parts.stateHandling.det += points;
    } else if (item.check.probe.probe === 'rendersFields' || item.check.probe.probe === 'calls') {
      points = hit.passed ? dataEach : 0;
      parts.dataAccuracy.det += points;
    } else if (item.source !== 'baseline') {
      points = itemPoints(item, hit.passed, detEach, judgeEach);
      parts.request.det += points;
    }
    return { id: item.id, passed: hit.passed, points: round1(points), evidence: hit.evidence.slice(0, 300) };
  });

  if (dataItems.length === 0) {
    parts.dataAccuracy.det = gates.find((g) => g.gate === 'usesRealData')?.passed ? 20 : 0;
  }

  const total = Math.round(
    SCORE_PARTS.reduce((n, p) => n + Math.min(parts[p].max, parts[p].det + parts[p].judge), 0),
  );
  const gatesPass = gates.every((g) => g.passed);
  const judgeRoom = parts.visual.judgeMax + parts.clarity.judgeMax + parts.request.judgeMax;
  return {
    total,
    parts: Object.fromEntries(
      SCORE_PARTS.map((p) => [
        p,
        { points: round1(parts[p].det), max: parts[p].max, det: round1(parts[p].det), judge: 0 },
      ]),
    ),
    groups: groupsOf(parts),
    gates,
    checklist: checklistRows,
    judge: { status: judgeRoom > 0 ? 'not_run' : 'unjudged', reason: null },
    eligible: gatesPass && total + judgeRoom >= LIMITS.variants.minShownScore,
  };
}

export const GROUP_KEYS = SCORE_GROUPS;
