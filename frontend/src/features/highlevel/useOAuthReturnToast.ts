import { watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { toast } from 'vue-sonner';
import { oauthErrorMessage, readOAuthReturn } from './connection-query';
import { useHighLevelConnection } from './useHighLevelConnection';

const NAME_WAIT_MS = 4_000;

/** Shows the result of the OAuth round trip once, then removes the query from the URL. */
export function useOAuthReturnToast(): void {
  const route = useRoute();
  const router = useRouter();
  const { locationName } = useHighLevelConnection();
  const result = readOAuthReturn(route.query);
  if (!result) return;
  void router.replace({ query: {} });

  if (result.kind === 'error') {
    toast.error(oauthErrorMessage(result.reason));
    return;
  }
  // The projection may arrive a moment after the redirect; prefer "Connected to <name>".
  let shown = false;
  const show = (name: string | null) => {
    if (shown) return;
    shown = true;
    toast.success(name ? `Connected to ${name}` : 'HighLevel connected');
  };
  const timer = setTimeout(() => {
    stop();
    show(null);
  }, NAME_WAIT_MS);
  const stop = watch(
    locationName,
    (name) => {
      if (!name) return;
      clearTimeout(timer);
      show(name);
      queueMicrotask(() => stop());
    },
    { immediate: true },
  );
}
