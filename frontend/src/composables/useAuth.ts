import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { computed, readonly, ref, shallowRef, type ComputedRef, type Ref } from 'vue';
import { auth } from '@/lib/firebase';

const user = shallowRef<User | null>(null);
const ready = ref(false);
let started = false;

/** Called once from main.ts. Firebase restores the persisted session before the first callback. */
export function startAuthListener(): void {
  if (started) return;
  started = true;
  onAuthStateChanged(auth(), (next) => {
    user.value = next;
    ready.value = true;
  });
}

export interface AuthApi {
  user: ComputedRef<User | null>;
  uid: ComputedRef<string | null>;
  ready: Readonly<Ref<boolean>>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuth(): AuthApi {
  return {
    user: computed(() => user.value),
    uid: computed(() => user.value?.uid ?? null),
    ready: readonly(ready),
    async signIn(email, password) {
      await signInWithEmailAndPassword(auth(), email.trim(), password);
    },
    async signUp(email, password) {
      await createUserWithEmailAndPassword(auth(), email.trim(), password);
    },
    async signOut() {
      await firebaseSignOut(auth());
    },
  };
}
