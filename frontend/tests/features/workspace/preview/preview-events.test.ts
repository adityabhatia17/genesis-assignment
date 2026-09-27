import { classifyPreviewEvents, type PreviewEvent } from '@/features/workspace/preview/preview-events';

const event = (over: Partial<PreviewEvent> = {}): PreviewEvent => ({
  id: 'e1',
  type: 'contact.created',
  locationId: 'loc_1',
  payload: { id: 'c1' },
  ...over,
});

describe('classifyPreviewEvents', () => {
  it('delivers a matching event once and skips the wrong location or an unknown type', () => {
    const events = [
      event(),
      event({ id: 'e2', locationId: 'other' }),
      event({ id: 'e3', type: 'UNINSTALL' }),
    ];
    const first = classifyPreviewEvents(events, 'loc_1', new Set());
    expect(first.deliver.map((e) => e.id)).toEqual(['e1']);
    expect(first.skip).toEqual(['e2', 'e3']);

    const again = classifyPreviewEvents(events, 'loc_1', new Set(['e1', 'e2', 'e3']));
    expect(again.deliver).toEqual([]);
    expect(again.skip).toEqual([]);
  });

  it('delivers nothing when the project has no location', () => {
    const result = classifyPreviewEvents([event()], null, new Set());
    expect(result.deliver).toEqual([]);
    expect(result.skip).toEqual(['e1']);
  });
});
