import { z } from 'zod';

const Quote = z.string().max(220);
const Anchored = z.strictObject({ score: z.number().int().min(1).max(5), evidence: Quote });

export const JudgeResultSchema = z.strictObject({
  options: z
    .array(
      z.strictObject({
        label: z.enum(['A', 'B', 'C', 'D']),
        visual: Anchored,
        clarity: Anchored,
        items: z
          .array(z.strictObject({ id: z.string().max(8), met: z.boolean().nullable(), evidence: Quote }))
          .max(8),
      }),
    )
    .min(1)
    .max(4),
});
export type JudgeResult = z.infer<typeof JudgeResultSchema>;
