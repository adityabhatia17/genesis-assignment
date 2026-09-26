import {
  onSnapshot,
  refEqual,
  type DocumentReference,
  type FirestoreError,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
  type ShallowRef,
} from 'vue';
import { isSignedOutDenial } from './firestore-errors';

export interface FirestoreDocState<T> {
  data: ShallowRef<T | null>;
  loading: Ref<boolean>;
  error: ShallowRef<FirestoreError | null>;
  retry: () => void;
}

/** Realtime document; re-subscribes when the reference changes and unsubscribes with the scope. */
export function useFirestoreDoc<T>(
  source: MaybeRefOrGetter<DocumentReference<T> | null>,
): FirestoreDocState<T> {
  const data = shallowRef<T | null>(null);
  const loading = ref(true);
  const error = shallowRef<FirestoreError | null>(null);
  const attempt = ref(0);
  let unsubscribe: Unsubscribe | null = null;
  let current: DocumentReference<T> | null = null;
  let currentAttempt = -1;

  const stop = watch(
    [() => toValue(source), attempt],
    ([next, nextAttempt]) => {
      if (next && current && refEqual(next, current) && nextAttempt === currentAttempt) return;
      unsubscribe?.();
      unsubscribe = null;
      current = next;
      currentAttempt = nextAttempt;
      error.value = null;
      if (!next) {
        data.value = null;
        loading.value = false;
        return;
      }
      loading.value = true;
      unsubscribe = onSnapshot(
        next,
        (snap) => {
          data.value = snap.exists() ? (snap.data() ?? null) : null;
          loading.value = false;
        },
        (e) => {
          if (isSignedOutDenial(e)) return;
          error.value = e;
          loading.value = false;
        },
      );
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    stop();
    unsubscribe?.();
  });

  return { data, loading, error, retry: () => void (attempt.value += 1) };
}
