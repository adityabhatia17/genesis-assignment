import { groupPercent, scoreAriaLabel } from '@/features/variants/score-display';
import { fallbackNotice, problemKind } from '@/features/variants/variants.labels';

const groups = {
  works: { points: 30, max: 35 },
  looks: { points: 20, max: 30 },
  request: { points: 15, max: 15 },
  easy: { points: 0, max: 0 },
};

describe('score display', () => {
  it('rounds a group to a percent and treats a zero max as zero', () => {
    expect(groupPercent(groups.works)).toBe(86);
    expect(groupPercent(groups.easy)).toBe(0);
    expect(groupPercent(groups.request)).toBe(100);
  });

  it('names the total and every group for assistive tech', () => {
    expect(scoreAriaLabel(72, groups)).toBe(
      'Score 72 out of 100. Works 30 of 35, Looks polished 20 of 30, Matches your request 15 of 15, Easy to use 0 of 0.',
    );
  });
});

describe('variants copy', () => {
  it('hides technical words and stays quiet when variants were simply off', () => {
    const text = [
      fallbackNotice('budget'),
      fallbackNotice('user_limit'),
      fallbackNotice('busy'),
      fallbackNotice('disabled'),
      fallbackNotice('not_first'),
    ].join(' ');
    expect(fallbackNotice('disabled')).toBeNull();
    expect(fallbackNotice('not_first')).toBeNull();
    expect(text).not.toMatch(/candidate|fixture|gate|checklist|probe/i);
  });

  it('maps a failed variants run onto a problem view', () => {
    expect(
      problemKind({
        mode: 'variants',
        status: 'failed',
        error: { code: 'GENERATION_INVALID_OUTPUT', message: '', retryable: true },
      }),
    ).toBe('none_qualified');
    expect(problemKind({ mode: 'single', status: 'failed', error: null })).toBeNull();
  });
});
