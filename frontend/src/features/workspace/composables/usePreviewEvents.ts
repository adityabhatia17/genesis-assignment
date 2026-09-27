import { watch } from 'vue';
import type { RuntimeEventName } from '@/contracts/hl-runtime';
import { useFirestoreQuery } from '@/composables/useFirestoreQuery';
import { recentEventsQuery } from '@/services/firestore/events.repo';
import type { PreviewHostBridge } from '../preview/host-bridge';
import { classifyPreviewEvents } from '../preview/preview-events';
import { useWorkspace } from '../workspace-context';

/** Relays HighLevel webhook events for this project's location into the running preview. */
export function usePreviewEvents(bridge: PreviewHostBridge): () => void {
  const ws = useWorkspace();
  const sinceMs = Date.now() - 2 * 60_000;
  const delivered = new Set<string>();
  const { data } = useFirestoreQuery(() => recentEventsQuery(ws.uid, sinceMs));

  function flush(): void {
    const locationId = ws.project.value?.locationId ?? null;
    const { deliver, skip } = classifyPreviewEvents(data.value, locationId, delivered);
    for (const id of skip) delivered.add(id);
    for (const event of deliver) {
      if (bridge.pushEvent(event.type as RuntimeEventName, event.payload)) delivered.add(event.id);
    }
  }

  watch(data, flush);
  watch(() => ws.project.value?.locationId ?? null, flush);
  return flush;
}
