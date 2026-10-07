import type { CandidateScore, RankedEntry, VariantsRanking } from '../../../contracts/variants.js';

export interface RankInput {
  candidateId: string;
  direction: { id: string; label: string };
  score: CandidateScore;
}

const better = (a: RankInput, b: RankInput): number => {
  if (b.score.total !== a.score.total) return b.score.total - a.score.total;
  const aw = a.score.groups.works.points;
  const bw = b.score.groups.works.points;
  if (bw !== aw) return bw - aw;
  const ad = a.score.parts.dataAccuracy?.points ?? 0;
  const bd = b.score.parts.dataAccuracy?.points ?? 0;
  if (bd !== ad) return bd - ad;
  return a.candidateId.localeCompare(b.candidateId);
};

/**
 * Always show the two highest scores. Gates and the score of 25 do not
 * remove a result. A run fails only when nothing was scored at all.
 */
export function rankCandidates(inputs: readonly RankInput[]): {
  ranking: VariantsRanking;
  notice: 'only_one_option' | null;
} {
  const ordered = [...inputs].sort(better);
  const shown = ordered.slice(0, 2);
  const top = shown[0];
  if (!top) return { ranking: { top: [], others: [], reasons: ['none_scored'] }, notice: null };

  const shownIds = new Set(shown.map((c) => c.candidateId));
  const topEntries: RankedEntry[] = shown.map((c, index) => ({
    candidateId: c.candidateId,
    rank: index + 1,
    topPick: index === 0,
    total: c.score.total,
    groups: c.score.groups,
    direction: c.direction,
  }));
  return {
    ranking: {
      top: topEntries,
      others: ordered
        .filter((c) => !shownIds.has(c.candidateId))
        .map((c) => ({ candidateId: c.candidateId, total: c.score.total })),
      reasons: shown.length < 2 ? ['only_one'] : ['top_two'],
    },
    notice: shown.length < 2 ? 'only_one_option' : null,
  };
}
