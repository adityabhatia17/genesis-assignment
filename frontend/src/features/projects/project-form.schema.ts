import { z } from 'zod';
import { LIMITS } from '@/contracts/limits';

/** Mirrors the rules' validProjectText (BE-2.1). */
export const ProjectFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required.')
    .max(LIMITS.projectNameMax, `Use at most ${LIMITS.projectNameMax} characters.`),
  description: z
    .string()
    .trim()
    .max(LIMITS.projectDescriptionMax, `Use at most ${LIMITS.projectDescriptionMax} characters.`),
});

export type ProjectFormValues = z.output<typeof ProjectFormSchema>;
