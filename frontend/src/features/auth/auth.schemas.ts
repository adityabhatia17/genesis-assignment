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
