import { effectScope, nextTick, ref } from 'vue';

const onSnapshot = vi.fn();
vi.mock('firebase/firestore', () => ({
  onSnapshot: (...args: unknown[]) => onSnapshot(...args) as unknown,
  queryEqual: (a: unknown, b: unknown) => a === b,
}));
vi.mock('@/lib/firebase', () => ({ auth: () => ({ currentUser: null }) }));

const { useFirestoreQuery } = await import('@/composables/useFirestoreQuery');

describe('useFirestoreQuery', () => {
  // Block body: Vitest treats a function returned from beforeEach as a cleanup hook.
  beforeEach(() => {
    onSnapshot.mockReset();
  });

  it('subscribes, delivers data and unsubscribes with its scope', () => {
    const unsubscribe = vi.fn();
    onSnapshot.mockImplementation((_q, next: (s: unknown) => void) => {
      next({ docs: [{ data: () => ({ id: 'a' }) }] });
      return unsubscribe;
    });
    const scope = effectScope();
    const state = scope.run(() => useFirestoreQuery(() => ({ q: 1 }) as never))!;
    expect(state.data.value).toEqual([{ id: 'a' }]);
    expect(state.loading.value).toBe(false);
    scope.stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('resubscribes when the query changes and clears for null', async () => {
    onSnapshot.mockReturnValue(vi.fn());
    const source = ref<object | null>({ q: 1 });
    const scope = effectScope();
    const state = scope.run(() => useFirestoreQuery(() => source.value as never))!;
    source.value = { q: 2 };
    await nextTick();
    expect(onSnapshot).toHaveBeenCalledTimes(2);
    source.value = null;
    await nextTick();
    expect(state.data.value).toEqual([]);
    scope.stop();
  });

  it('ignores permission-denied right after sign-out', () => {
    onSnapshot.mockImplementation((_q, _next, error: (e: unknown) => void) => {
      error({ code: 'permission-denied' });
      return vi.fn();
    });
    const scope = effectScope();
    const state = scope.run(() => useFirestoreQuery(() => ({}) as never))!;
    expect(state.error.value).toBeNull();
    scope.stop();
  });
});
