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
