export interface Clock {
  now(): number; // epoch milliseconds
}

export const systemClock: Clock = { now: () => Date.now() };

export interface FakeClock extends Clock {
  advance(ms: number): void;
  set(ms: number): void;
}

export function createFakeClock(startMs: number): FakeClock {
  let t = startMs;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    set: (ms) => {
      t = ms;
    },
  };
}
