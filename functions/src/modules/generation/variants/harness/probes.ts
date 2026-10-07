import type { Probe } from '../../../../contracts/variants.js';
import type { FixtureSet } from './fixtures.js';
import { FIXTURE_A, FIXTURE_B } from './fixtures.js';
import type { Observation } from './sandbox/sandbox-entry.js';

export interface ProbeHit {
  passed: boolean;
  evidence: string;
}

const byName = (runs: readonly Observation[], name: string) => runs.find((r) => r.scenario === name);

function values(fixture: FixtureSet): string[] {
  return [
    ...fixture.contacts.map((c) => c.name),
    ...fixture.events.map((e) => e.title),
    ...fixture.conversations.map((c) => c.contactName),
  ];
}

export function evalProbe(probe: Probe, runs: readonly Observation[]): ProbeHit {
  const data = byName(runs, 'data');
  const empty = byName(runs, 'empty');
  const error = byName(runs, 'error');
  const loading = byName(runs, 'loading');
  const text = data?.text ?? '';

  switch (probe.probe) {
    case 'calls': {
      const hit = data?.calls.some((c) => c.method === probe.method) ?? false;
      return { passed: hit, evidence: hit ? `called ${probe.method}` : `did not call ${probe.method}` };
    }
    case 'rendersFields': {
      const shown = values(FIXTURE_A).filter((v) => text.includes(v));
      const leaked = values(FIXTURE_B).filter((v) => text.includes(v));
      const passed = shown.length > 0 && leaked.length === 0;
      return {
        passed,
        evidence: passed ? `showed ${shown[0]}` : 'did not show the fixture values',
      };
    }
    case 'sortedBy': {
      const titles = FIXTURE_A.events.map((e) => e.title).filter((t) => text.includes(t));
      if (titles.length < 2) return { passed: false, evidence: 'not enough rows to check order' };
      const positions = titles.map((t) => text.indexOf(t));
      const ordered = probe.direction === 'asc' ? positions.every((p, i) => i === 0 || positions[i - 1]! <= p) : true;
      return { passed: ordered, evidence: ordered ? 'rows are ordered' : 'rows are out of order' };
    }
    case 'searchCallsWith': {
      const search = byName(runs, 'search');
      const hit = search?.calls.some((c) => c.method === probe.method && 'query' in c.params) ?? false;
      return { passed: hit, evidence: hit ? 'search sent a query' : 'search did not call the method' };
    }
    case 'hasControl': {
      const passed =
        probe.control === 'search'
          ? (data?.inputs ?? 0) > 0
          : (data?.buttons.some((b) => new RegExp(probe.control, 'i').test(b)) ?? false);
      return { passed, evidence: passed ? `has a ${probe.control} control` : `no ${probe.control} control` };
    }
    case 'state.loading': {
      const passed = (loading?.text.length ?? 0) > 0 && (loading?.calls.length ?? 0) > 0 && !values(FIXTURE_A).some((v) => loading?.text.includes(v));
      return { passed, evidence: passed ? 'shows a waiting state' : 'no waiting state' };
    }
    case 'state.empty': {
      const passed = (empty?.text.trim().length ?? 0) > 0 && !values(FIXTURE_A).some((v) => empty?.text.includes(v));
      return { passed, evidence: passed ? 'says the list is empty' : 'no empty state' };
    }
    case 'state.error': {
      const passed = (error?.text.trim().length ?? 0) > 0;
      return { passed, evidence: passed ? 'says loading failed' : 'no error state' };
    }
    case 'loadMoreAppends': {
      const more = byName(runs, 'twoPages');
      const first = more?.calls.filter((c) => c.method === probe.method).length ?? 0;
      return { passed: first >= 2, evidence: first >= 2 ? 'requested a second page' : 'did not request more' };
    }
    case 'dateRangeCall': {
      const hit = data?.calls.some((c) => c.method === 'calendars.events' && 'from' in c.params && 'to' in c.params) ?? false;
      return { passed: hit, evidence: hit ? 'sent a date range' : 'no date range' };
    }
    default:
      return { passed: false, evidence: 'unknown probe' };
  }
}

export const renderedAsHtml = (runs: readonly Observation[]): boolean =>
  runs.some((r) => r.scenario === 'adversarial' && r.hasImgPayload);
