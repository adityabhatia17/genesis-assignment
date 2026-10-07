import type { GateName } from '../../../../contracts/variants.js';
import { FIXTURE_A, FIXTURE_B } from './fixtures.js';
import { renderedAsHtml } from './probes.js';
import type { Observation } from './sandbox/sandbox-entry.js';

export interface GateResult {
  gate: GateName;
  passed: boolean;
  detail: string;
}

const names = (set: typeof FIXTURE_A) => [...set.contacts.map((c) => c.name), ...set.events.map((e) => e.title)];

export function evaluateGates(i: {
  hasEntry: boolean;
  runs: readonly Observation[];
}): GateResult[] {
  const data = i.runs.find((r) => r.scenario === 'data');
  const dataB = i.runs.find((r) => r.scenario === 'dataB');
  const textA = data?.text ?? '';
  const textB = dataB?.text ?? '';
  const showsA = names(FIXTURE_A).some((n) => textA.includes(n));
  const showsOnlyA = showsA && !names(FIXTURE_B).some((n) => textA.includes(n));
  const showsB = names(FIXTURE_B).some((n) => textB.includes(n));
  const boots = Boolean(data && !data.error && textA.trim().length > 0);
  const safe = !renderedAsHtml(i.runs);
  return [
    {
      gate: 'validOutput',
      passed: i.hasEntry,
      detail: i.hasEntry ? 'index.html is present' : 'index.html is missing',
    },
    { gate: 'boots', passed: boots, detail: boots ? 'the page rendered' : 'the page did not render' },
    {
      gate: 'usesRealData',
      passed: showsOnlyA && showsB,
      detail: showsOnlyA && showsB ? 'each run showed its own fixture' : 'the page did not follow the fixture',
    },
    { gate: 'safe', passed: safe, detail: safe ? 'fixture text stayed text' : 'fixture markup became an element' },
  ];
}
