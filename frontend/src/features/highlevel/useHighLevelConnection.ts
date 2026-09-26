import { createSharedComposable, useEventListener } from '@vueuse/core';
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { toast } from 'vue-sonner';
import type { IntegrationStatus } from '@/contracts/firestore-docs';
import { useAuth } from '@/composables/useAuth';
import { useFirestoreDoc } from '@/composables/useFirestoreDoc';
import { toUserMessage } from '@/lib/errors';
import { disconnectHighLevel, startHighLevelOAuth } from '@/services/api/hl-oauth.api';
import { refs } from '@/services/firestore/paths';

export type ConnectionStatus = 'loading' | IntegrationStatus;

export interface HighLevelConnection {
  status: ComputedRef<ConnectionStatus>;
  locationId: ComputedRef<string | null>;
  locationName: ComputedRef<string | null>;
  timezone: ComputedRef<string | null>;
  scopes: ComputedRef<string[]>;
  connecting: Ref<boolean>;
  disconnecting: Ref<boolean>;
  connect: (returnPath?: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

function createConnection(): HighLevelConnection {
  const { uid } = useAuth();
  const { data, loading } = useFirestoreDoc(() => (uid.value ? refs.integration(uid.value) : null));

  const status = computed<ConnectionStatus>(() =>
    loading.value ? 'loading' : (data.value?.status ?? 'disconnected'),
  );
  const linked = computed(() => status.value === 'connected' || status.value === 'reauth_required');
  const connecting = ref(false);
  const disconnecting = ref(false);

  // Coming back with the browser's Back button restores this page from the bfcache mid-"connecting".
  useEventListener(window, 'pageshow', (event: PageTransitionEvent) => {
    if (event.persisted) connecting.value = false;
  });

  async function connect(returnPath = '/dashboard'): Promise<void> {
    if (connecting.value) return;
    connecting.value = true;
    try {
      window.location.assign(await startHighLevelOAuth(returnPath));
    } catch (error) {
      connecting.value = false;
      toast.error(toUserMessage(error));
    }
  }

  async function disconnect(): Promise<void> {
    if (disconnecting.value) return;
    disconnecting.value = true;
    try {
      await disconnectHighLevel();
      toast.success('HighLevel disconnected');
    } catch (error) {
      toast.error(toUserMessage(error));
    } finally {
      disconnecting.value = false;
    }
  }

  return {
    status,
    locationId: computed(() => (linked.value ? (data.value?.locationId ?? null) : null)),
    locationName: computed(() => (linked.value ? (data.value?.locationName ?? null) : null)),
    timezone: computed(() => (linked.value ? (data.value?.timezone ?? null) : null)),
    scopes: computed(() => data.value?.scopes ?? []),
    connecting,
    disconnecting,
    connect,
    disconnect,
  };
}

/** One Firestore listener for the whole app, shared by the badge, the card and the workspace. */
export const useHighLevelConnection = createSharedComposable(createConnection);
