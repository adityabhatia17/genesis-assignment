import { isLeaseStale } from '../../../src/modules/projects/project-access.js';

describe('lease staleness', () => {
  it('is stale only after 60 s without heartbeat', () => {
    expect(isLeaseStale(null, 1_000_000)).toBe(false);
    expect(isLeaseStale({ heartbeatAtMs: 1_000_000 }, 1_060_000)).toBe(false);
    expect(isLeaseStale({ heartbeatAtMs: 1_000_000 }, 1_060_001)).toBe(true);
  });
});
