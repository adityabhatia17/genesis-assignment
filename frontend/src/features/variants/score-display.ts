import type { RankedEntry } from '@/contracts/variants';

export const GROUP_LABELS = {
  works: 'Works',
  looks: 'Looks polished',
  request: 'Matches your request',
  easy: 'Easy to use',
} as const;

export type ScoreGroups = RankedEntry['groups'];

export function groupPercent(group: { points: number; max: number }): number {
  if (group.max <= 0) return 0;
  return Math.round((group.points / group.max) * 100);
}

/** One accessible name for the whole score. Visual marks are decorative. */
export function scoreAriaLabel(total: number, groups: ScoreGroups): string {
  const parts = (Object.keys(GROUP_LABELS) as (keyof typeof GROUP_LABELS)[])
    .map((key) => {
      const group = groups[key];
      return `${GROUP_LABELS[key]} ${group.points} of ${group.max}`;
    })
    .join(', ');
  return `Score ${total} out of 100. ${parts}.`;
}
