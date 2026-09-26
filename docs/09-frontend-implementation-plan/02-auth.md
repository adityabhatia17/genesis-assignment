# FE-1 — Authentication (R-AUTH1, R-AUTH2, R-FE2)

> Read [`00-overview.md`](00-overview.md) first. Spec: [`../06-frontend-system-design.md`](../06-frontend-system-design.md) §6; flow: [`../07-end-to-end-system-design.md`](../07-end-to-end-system-design.md) §4.1.

---

### Task FE-1.1: `useAuth` — session state and actions

**Files:**
- Create: `frontend/src/composables/useAuth.ts`
- Modify: `frontend/src/main.ts` (call `startAuthListener()` after `configureHttp`, as shown in FE-0.6)

**Interfaces:** Produces `startAuthListener()`, `useAuth() → { user: ComputedRef<User | null>; uid: ComputedRef<string | null>; ready; signIn(email, password); signUp(email, password); signOut() }`.

- [ ] **Step 1: Implement**

`frontend/src/composables/useAuth.ts`:
```ts
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
```

Session persistence (R-AUTH2) is the Firebase default (`browserLocalPersistence`, IndexedDB); the router guard awaits `auth().authStateReady()` so a refresh never flashes the sign-in page.

- [ ] **Step 2: Verify manually against the Auth emulator** (`npm run emulators` at the root, `npm run dev`): after FE-1.3, sign up, refresh — still signed in; the Emulator UI (http://127.0.0.1:4000/auth) lists the user.

- [ ] **Step 3: Commit** — `feat(frontend): add auth state composable`

---

### Task FE-1.2: Form validation and Firebase error messages

**Files:**
- Create: `frontend/src/composables/useZodForm.ts`, `frontend/src/features/auth/auth.schemas.ts`, `frontend/src/features/auth/auth-errors.ts`, `frontend/src/features/auth/redirect.ts`
- Test: `frontend/tests/composables/useZodForm.test.ts`, `frontend/tests/features/auth/auth.test.ts`

**Interfaces:** Produces `useZodForm(schema, initial) → { values, errors, submitting, formError, validate, handleSubmit(onValid, mapError?), reset }`; `authFormSchema(mode)`, `AuthMode`; `authErrorMessage(error)`; `safeRedirect(value): string | null`.

> No vee-validate: `@vee-validate/zod` requires zod 3 while the shared contracts use zod 4 (research/05 §1). `useZodForm` is ~60 lines and fits shadcn-vue's `Field` components.

- [ ] **Step 1: Failing tests**

`frontend/tests/composables/useZodForm.test.ts`:
```ts
import { z } from 'zod';
import { useZodForm } from '@/composables/useZodForm';

const Schema = z.object({ name: z.string().trim().min(1, 'Required') });

describe('useZodForm', () => {
  it('collects the first message per field and blocks invalid submits', async () => {
    const form = useZodForm(Schema, { name: '' });
    const onValid = vi.fn(() => Promise.resolve());
    await form.handleSubmit(onValid)();
    expect(form.errors.name).toBe('Required');
    expect(onValid).not.toHaveBeenCalled();
  });

  it('submits parsed data and maps thrown errors to formError', async () => {
    const form = useZodForm(Schema, { name: '  Clinic ' });
    const onValid = vi.fn(() => Promise.reject(new Error('boom')));
    await form.handleSubmit(onValid, () => 'Mapped')();
    expect(onValid).toHaveBeenCalledWith({ name: 'Clinic' });
    expect(form.formError.value).toBe('Mapped');
    expect(form.submitting.value).toBe(false);
  });

  it('reset clears values and errors', async () => {
    const form = useZodForm(Schema, { name: '' });
    await form.handleSubmit(() => Promise.resolve())();
    form.reset({ name: 'x' });
    expect(form.values.name).toBe('x');
    expect(form.errors.name).toBeUndefined();
  });
});
```

`frontend/tests/features/auth/auth.test.ts`:
```ts
import { FirebaseError } from 'firebase/app';
import { authErrorMessage } from '@/features/auth/auth-errors';
import { authFormSchema } from '@/features/auth/auth.schemas';
import { safeRedirect } from '@/features/auth/redirect';

describe('auth schemas', () => {
  it('sign-in only needs an email and a password', () => {
    expect(
      authFormSchema('sign-in').safeParse({ email: ' a@b.co ', password: 'x', confirm: '' })
        .success,
    ).toBe(true);
  });
  it('sign-up enforces length and matching confirmation', () => {
    const result = authFormSchema('sign-up').safeParse({
      email: 'a@b.co',
      password: 'short',
      confirm: 'other',
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['password', 'confirm']));
  });
});

describe('authErrorMessage', () => {
  it.each([
    ['auth/email-already-in-use', 'An account with this email already exists.'],
    ['auth/invalid-credential', 'Email or password is incorrect.'],
    ['auth/too-many-requests', 'Too many attempts. Try again in a few minutes.'],
    ['auth/unknown', 'Something went wrong. Please try again.'],
  ])('%s', (code, message) => {
    expect(authErrorMessage(new FirebaseError(code, 'raw'))).toBe(message);
  });
});

describe('safeRedirect', () => {
  it('allows only same-app paths', () => {
    expect(safeRedirect('/projects/p1')).toBe('/projects/p1');
    expect(safeRedirect('//evil.example')).toBeNull();
    expect(safeRedirect('/\\evil.example')).toBeNull();
    expect(safeRedirect('https://evil.example')).toBeNull();
    expect(safeRedirect(['/a'])).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

`frontend/src/composables/useZodForm.ts`:
```ts
import { reactive, ref, type Ref } from 'vue';
import type { z } from 'zod';
import { toUserMessage } from '@/lib/errors';

type Values<S extends z.ZodObject> = z.input<S>;
type Field<S extends z.ZodObject> = Extract<keyof Values<S>, string>;

export interface ZodForm<S extends z.ZodObject> {
  values: Values<S>;
  errors: Partial<Record<Field<S>, string>>;
  submitting: Ref<boolean>;
  formError: Ref<string | null>;
  validate: () => z.output<S> | null;
  handleSubmit: (
    onValid: (data: z.output<S>) => Promise<void>,
    mapError?: (error: unknown) => string,
  ) => (event?: Event) => Promise<void>;
  reset: (next: Values<S>) => void;
}

/** Minimal form state for shadcn-vue Field components validated by a zod object schema. */
export function useZodForm<S extends z.ZodObject>(schema: S, initial: Values<S>): ZodForm<S> {
  const values = reactive({ ...initial }) as Values<S>;
  const errors = reactive({}) as Partial<Record<Field<S>, string>>;
  const submitting = ref(false);
  const formError = ref<string | null>(null);

  function clearErrors(): void {
    for (const key of Object.keys(errors)) delete (errors as Record<string, unknown>)[key];
  }

  function validate(): z.output<S> | null {
    clearErrors();
    const result = schema.safeParse(values);
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? '') as Field<S>;
      if (key && errors[key] === undefined) errors[key] = issue.message;
    }
    return null;
  }

  function handleSubmit(
    onValid: (data: z.output<S>) => Promise<void>,
    mapError: (error: unknown) => string = toUserMessage,
  ) {
    return async (event?: Event): Promise<void> => {
      event?.preventDefault();
      if (submitting.value) return;
      formError.value = null;
      const data = validate();
      if (!data) return;
      submitting.value = true;
      try {
        await onValid(data);
      } catch (error) {
        formError.value = mapError(error);
      } finally {
        submitting.value = false;
      }
    };
  }

  function reset(next: Values<S>): void {
    Object.assign(values as object, next);
    clearErrors();
    formError.value = null;
  }

  return { values, errors, submitting, formError, validate, handleSubmit, reset };
}
```

`frontend/src/features/auth/auth.schemas.ts`:
```ts
import { z } from 'zod';

export type AuthMode = 'sign-in' | 'sign-up';

const Email = z.string().trim().pipe(z.email('Enter a valid email address.'));

/** One shape for both screens so a single form component can serve them. */
export function authFormSchema(mode: AuthMode) {
  return z
    .object({
      email: Email,
      password:
        mode === 'sign-up'
          ? z.string().min(8, 'Use at least 8 characters.').max(128, 'Use at most 128 characters.')
          : z.string().min(1, 'Enter your password.'),
      confirm: z.string(),
    })
    .refine((v) => mode === 'sign-in' || v.password === v.confirm, {
      path: ['confirm'],
      message: 'Passwords do not match.',
    });
}

export type AuthFormSchema = ReturnType<typeof authFormSchema>;
```

`frontend/src/features/auth/auth-errors.ts`:
```ts
import { FirebaseError } from 'firebase/app';

const GENERIC = 'Something went wrong. Please try again.';
const WRONG_CREDENTIALS = 'Email or password is incorrect.';

const MESSAGES: Readonly<Record<string, string>> = {
  'auth/email-already-in-use': 'An account with this email already exists.',
  'auth/invalid-credential': WRONG_CREDENTIALS,
  'auth/invalid-login-credentials': WRONG_CREDENTIALS,
  'auth/wrong-password': WRONG_CREDENTIALS,
  'auth/user-not-found': WRONG_CREDENTIALS,
  'auth/weak-password': 'Choose a stronger password (at least 8 characters).',
  'auth/password-does-not-meet-requirements': 'Choose a stronger password (at least 8 characters).',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
  'auth/network-request-failed': 'Network error — check your connection.',
  'auth/user-disabled': 'This account has been disabled.',
};

export function authErrorMessage(error: unknown): string {
  return error instanceof FirebaseError ? (MESSAGES[error.code] ?? GENERIC) : GENERIC;
}
```

`frontend/src/features/auth/redirect.ts`:
```ts
/** Only same-app absolute paths are allowed after sign-in (prevents open redirects). */
export function safeRedirect(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  return value;
}
```

- [ ] **Step 3: Run** `npm test` → PASS. **Commit** — `feat(frontend): add zod form helper, auth schemas and error messages`

---

### Task FE-1.3: Sign-in and sign-up screens

**Files:**
- Create: `frontend/src/features/auth/AuthForm.vue`, `SignInPage.vue`, `SignUpPage.vue`

**Interfaces:** Consumes `useAuth`, `useZodForm`, `authFormSchema`, `authErrorMessage`, `safeRedirect`.

- [ ] **Step 1: Implement**

`frontend/src/features/auth/AuthForm.vue`:
```vue
<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/composables/useAuth';
import { useZodForm } from '@/composables/useZodForm';
import { authErrorMessage } from './auth-errors';
import { authFormSchema, type AuthMode } from './auth.schemas';
import { safeRedirect } from './redirect';

const props = defineProps<{ mode: AuthMode }>();

const router = useRouter();
const route = useRoute();
const { signIn, signUp } = useAuth();
const isSignUp = computed(() => props.mode === 'sign-up');

const { values, errors, submitting, formError, handleSubmit } = useZodForm(
  authFormSchema(props.mode),
  { email: '', password: '', confirm: '' },
);

const submit = handleSubmit(async ({ email, password }) => {
  if (isSignUp.value) await signUp(email, password);
  else await signIn(email, password);
  await router.replace(safeRedirect(route.query['redirect']) ?? { name: 'dashboard' });
}, authErrorMessage);
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>{{ isSignUp ? 'Create your account' : 'Sign in' }}</CardTitle>
      <CardDescription>
        {{
          isSignUp ? 'Describe an app, watch it get built on your HighLevel data.' : 'Welcome back.'
        }}
      </CardDescription>
    </CardHeader>
    <form novalidate @submit="submit">
      <CardContent>
        <FieldGroup>
          <Alert v-if="formError" variant="destructive" role="alert">
            <AlertDescription>{{ formError }}</AlertDescription>
          </Alert>
          <Field :data-invalid="!!errors.email">
            <FieldLabel for="auth-email">Email</FieldLabel>
            <Input
              id="auth-email"
              v-model="values.email"
              type="email"
              autocomplete="email"
              :aria-invalid="!!errors.email"
            />
            <FieldError v-if="errors.email">{{ errors.email }}</FieldError>
          </Field>
          <Field :data-invalid="!!errors.password">
            <FieldLabel for="auth-password">Password</FieldLabel>
            <Input
              id="auth-password"
              v-model="values.password"
              type="password"
              :autocomplete="isSignUp ? 'new-password' : 'current-password'"
              :aria-invalid="!!errors.password"
            />
            <FieldError v-if="errors.password">{{ errors.password }}</FieldError>
          </Field>
          <Field v-if="isSignUp" :data-invalid="!!errors.confirm">
            <FieldLabel for="auth-confirm">Confirm password</FieldLabel>
            <Input
              id="auth-confirm"
              v-model="values.confirm"
              type="password"
              autocomplete="new-password"
              :aria-invalid="!!errors.confirm"
            />
            <FieldError v-if="errors.confirm">{{ errors.confirm }}</FieldError>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter class="mt-6 flex flex-col gap-3">
        <Button type="submit" class="w-full" :disabled="submitting">
          <Spinner v-if="submitting" />
          {{ isSignUp ? 'Create account' : 'Sign in' }}
        </Button>
        <p class="text-center text-sm text-muted-foreground">
          <template v-if="isSignUp">
            Already have an account?
            <RouterLink
              :to="{ name: 'sign-in', query: route.query }"
              class="text-foreground underline-offset-4 hover:underline"
              >Sign in</RouterLink
            >
          </template>
          <template v-else>
            New to Genesis?
            <RouterLink
              :to="{ name: 'sign-up', query: route.query }"
              class="text-foreground underline-offset-4 hover:underline"
              >Create an account</RouterLink
            >
          </template>
        </p>
      </CardFooter>
    </form>
  </Card>
</template>
```

`frontend/src/features/auth/SignInPage.vue`:
```vue
<script setup lang="ts">
import AuthForm from './AuthForm.vue';
</script>

<template>
  <AuthForm mode="sign-in" />
</template>
```

`frontend/src/features/auth/SignUpPage.vue`:
```vue
<script setup lang="ts">
import AuthForm from './AuthForm.vue';
</script>

<template>
  <AuthForm mode="sign-up" />
</template>
```

- [ ] **Step 2: Verify** (emulators running): submitting empty shows "Enter a valid email address." and "Enter your password."; wrong password shows "Email or password is incorrect."; signing up twice with one email shows "An account with this email already exists."; after sign-in you land on `?redirect=` if it is a safe path, else `/dashboard`.

- [ ] **Step 3: Commit** — `feat(frontend): add sign-in and sign-up screens`

---

### Task FE-1.4: User menu and sign-out

**Files:**
- Create: `frontend/src/components/common/UserMenu.vue`

**Interfaces:** Consumes `useAuth().signOut`, `useTheme`, `installAuthRedirect` (FE-0.6 moves protected pages to `/sign-in` when the session ends). Used by `AppHeader` (FE-2.2) and `WorkspaceHeader` (FE-3.1).

- [ ] **Step 1: Implement**

`frontend/src/components/common/UserMenu.vue`:
```vue
<script setup lang="ts">
import { LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from '@lucide/vue';
import { computed } from 'vue';
import { toast } from 'vue-sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/composables/useAuth';
import { isThemeMode, useTheme } from '@/composables/useTheme';
import { toUserMessage } from '@/lib/errors';

const { user, signOut } = useAuth();
const { mode, setMode } = useTheme();

const email = computed(() => user.value?.email ?? '');
const initials = computed(() => email.value.slice(0, 2).toUpperCase() || '?');

function onTheme(value: unknown): void {
  if (isThemeMode(value)) setMode(value);
}

async function onSignOut(): Promise<void> {
  try {
    // installAuthRedirect() (router.ts) moves protected pages to /sign-in once the session ends.
    await signOut();
  } catch (error) {
    toast.error(toUserMessage(error));
  }
}
</script>

<template>
  <DropdownMenu v-if="user">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon-sm" class="rounded-full" aria-label="Account menu">
        <Avatar class="size-7">
          <AvatarFallback class="text-[11px] font-medium">{{ initials }}</AvatarFallback>
        </Avatar>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-56">
      <DropdownMenuLabel class="truncate font-normal text-muted-foreground">
        {{ email }}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuLabel class="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
      <DropdownMenuRadioGroup :model-value="mode" @update:model-value="onTheme">
        <DropdownMenuRadioItem value="light"><SunIcon />Light</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="dark"><MoonIcon />Dark</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="auto"><MonitorIcon />System</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem @select="onSignOut"><LogOutIcon />Sign out</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
```

After sign-out, Firestore listeners briefly fail with `permission-denied`; `useFirestoreQuery`/`useFirestoreDoc` (FE-2.1) ignore exactly that case so no error flashes.

- [ ] **Step 2: Verify** — sign out from the dashboard → `/sign-in`; the browser Back button does not show protected content (guard redirects).

- [ ] **Step 3: Commit** — `feat(frontend): add user menu with theme and sign-out`
