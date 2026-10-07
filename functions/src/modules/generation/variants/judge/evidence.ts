import type { JudgeResult } from './judge.schema.js';

/** A quote counts only when it appears in the text the judge was shown. */
export function verifyQuotes(result: JudgeResult, source: string): JudgeResult {
  const ok = (quote: string) => quote.length > 0 && source.includes(quote);
  return {
    options: result.options.map((option) => ({
      ...option,
      visual: ok(option.visual.evidence) ? option.visual : { score: 3, evidence: '' },
      clarity: ok(option.clarity.evidence) ? option.clarity : { score: 3, evidence: '' },
      items: option.items.map((item) =>
        item.met === null || ok(item.evidence) ? item : { ...item, met: null, evidence: '' },
      ),
    })),
  };
}
