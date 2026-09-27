import { RUNTIME_EVENT_NAMES, type RuntimeEventName } from '@/contracts/hl-runtime';

export interface PreviewEvent {
  readonly id: string;
  readonly type: string;
  readonly locationId: string;
  readonly payload: Record<string, string>;
}

const isEventName = (value: string): value is RuntimeEventName =>
  (RUNTIME_EVENT_NAMES as readonly string[]).includes(value);

/**
 * Events the open preview should receive. Wrong location and unknown types are
 * skipped. Matching events stay out of `deliver` until the caller confirms the
 * preview port accepted them.
 */
export function classifyPreviewEvents(
  events: readonly PreviewEvent[],
  locationId: string | null,
  delivered: ReadonlySet<string>,
): { deliver: PreviewEvent[]; skip: string[] } {
  const deliver: PreviewEvent[] = [];
  const skip: string[] = [];
  for (const event of events) {
    if (delivered.has(event.id)) continue;
    if (locationId !== null && event.locationId === locationId && isEventName(event.type)) {
      deliver.push(event);
    } else {
      skip.push(event.id);
    }
  }
  return { deliver, skip };
}
