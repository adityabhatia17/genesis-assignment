import {
  onSnapshot,
  queryEqual,
  type FirestoreError,
  type Query,
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

export interface FirestoreQueryState<T> {
  data: ShallowRef<T[]>;
  loading: Ref<boolean>;
  error: ShallowRef<FirestoreError | null>;
  retry: () => void;
}

/** Realtime query results (shallow: a new array per snapshot, documents are not deeply reactive). */
export function useFirestoreQuery<T>(
  source: MaybeRefOrGetter<Query<T> | null>,
): FirestoreQueryState<T> {
  const data = shallowRef<T[]>([]);
  const loading = ref(true);
  const error = shallowRef<FirestoreError | null>(null);
  const attempt = ref(0);
  let unsubscribe: Unsubscribe | null = null;
  let current: Query<T> | null = null;
  let currentAttempt = -1;

  const stop = watch(
    [() => toValue(source), attempt],
    ([next, nextAttempt]) => {
      if (next && current && queryEqual(next, current) && nextAttempt === currentAttempt) return;
      unsubscribe?.();
      unsubscribe = null;
      current = next;
      currentAttempt = nextAttempt;
      error.value = null;
      if (!next) {
        data.value = [];
        loading.value = false;
        return;
      }
      loading.value = true;
      unsubscribe = onSnapshot(
        next,
        (snap) => {
          data.value = snap.docs.map((d) => d.data());
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
