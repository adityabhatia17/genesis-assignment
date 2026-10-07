import type { ChecklistItem, Probe } from '../../../../contracts/variants.js';
import type { CatalogMethod } from '../sdk-catalog.js';

const item = (
  id: string,
  text: string,
  probe: Probe,
): ChecklistItem => ({
  id,
  text,
  kind: 'core',
  source: 'baseline',
  check: { type: 'probe', probe },
});

/**
 * Universal states, plus paging and date-range only when the catalog makes
 * them possible. Baseline probes are never offered to the checklist model.
 */
export function baselineItems(catalog: readonly CatalogMethod[]): ChecklistItem[] {
  const items: ChecklistItem[] = [
    item('B1', 'Shows a loading state while data is on its way', { probe: 'state.loading' }),
    item('B2', 'Says when there is nothing to show', { probe: 'state.empty' }),
    item('B3', 'Says when the data could not be loaded', { probe: 'state.error' }),
  ];
  const paged = catalog.find((m) => m.paged);
  if (paged) {
    items.push(
      item('B4', 'Loads further records when there are more', {
        probe: 'loadMoreAppends',
        method: paged.name,
      }),
    );
  }
  if (catalog.some((m) => m.name === 'calendars.events')) {
    items.push(
      item('B5', 'Asks for appointments in a bounded date range', {
        probe: 'dateRangeCall',
        method: 'calendars.events',
      }),
    );
  }
  return items;
}
