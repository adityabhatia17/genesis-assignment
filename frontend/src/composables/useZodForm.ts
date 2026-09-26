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
