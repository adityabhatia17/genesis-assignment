import { z } from 'zod';
import { RUNTIME_METHOD_NAMES } from './hl-runtime.js';

export const RuntimeMethodSchema = z.enum(RUNTIME_METHOD_NAMES);
const Method = RuntimeMethodSchema;

/** Probes the checklist model may choose from. */
export const LlmProbeSchema = z.discriminatedUnion('probe', [
  z.strictObject({ probe: z.literal('calls'), method: Method }),
  z.strictObject({
    probe: z.literal('rendersFields'),
    method: Method,
    fields: z.array(z.string().min(1)).min(1).max(8),
  }),
  z.strictObject({
    probe: z.literal('sortedBy'),
    method: Method,
    field: z.string().min(1),
    direction: z.enum(['asc', 'desc']),
  }),
  z.strictObject({
    probe: z.literal('searchCallsWith'),
    method: Method,
    param: z.literal('query'),
  }),
  z.strictObject({
    probe: z.literal('hasControl'),
    control: z.enum(['search', 'filter', 'refresh', 'dateRange']),
  }),
]);
export type LlmProbe = z.infer<typeof LlmProbeSchema>;

/** Probes only code adds (baseline items). Never offered to the model. */
export const BaselineProbeSchema = z.discriminatedUnion('probe', [
  z.strictObject({ probe: z.literal('state.loading') }),
  z.strictObject({ probe: z.literal('state.empty') }),
  z.strictObject({ probe: z.literal('state.error') }),
  z.strictObject({ probe: z.literal('loadMoreAppends'), method: Method }),
  z.strictObject({ probe: z.literal('dateRangeCall'), method: z.literal('calendars.events') }),
]);
export type BaselineProbe = z.infer<typeof BaselineProbeSchema>;

export const ProbeSchema = z.union([LlmProbeSchema, BaselineProbeSchema]);
export type Probe = z.infer<typeof ProbeSchema>;

const CheckSchema = z.union([
  z.strictObject({ type: z.literal('probe'), probe: ProbeSchema }),
  z.strictObject({ type: z.literal('judge') }),
]);

export const ChecklistItemSchema = z.strictObject({
  id: z.string().regex(/^[A-Z]\d{1,2}$/),
  text: z.string().min(1).max(140),
  kind: z.enum(['core', 'nice']),
  source: z.enum(['explicit', 'implied', 'baseline']),
  check: CheckSchema,
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

const LlmCheckSchema = z.union([
  z.strictObject({ type: z.literal('probe'), probe: LlmProbeSchema }),
  z.strictObject({ type: z.literal('judge') }),
]);

/** What the checklist model returns: no baseline items, no baseline probes. */
export const LlmChecklistSchema = z.strictObject({
  appType: z.enum(['list', 'detail', 'summary', 'mixed']),
  primaryMethods: z.array(Method).min(1).max(4),
  items: z
    .array(
      z.strictObject({
        id: z.string().regex(/^R\d{1,2}$/),
        text: z.string().min(1).max(140),
        kind: z.enum(['core', 'nice']),
        source: z.enum(['explicit', 'implied']),
        check: LlmCheckSchema,
      }),
    )
    .min(1)
    .max(8),
  unsupported: z
    .array(z.strictObject({ request: z.string().max(200), reason: z.string().max(300) }))
    .max(5),
});
export type LlmChecklist = z.infer<typeof LlmChecklistSchema>;

/** The merged checklist stored on the run. */
export const ChecklistSchema = z.strictObject({
  appType: LlmChecklistSchema.shape.appType,
  primaryMethods: LlmChecklistSchema.shape.primaryMethods,
  items: z.array(ChecklistItemSchema).min(3).max(12),
  unsupported: LlmChecklistSchema.shape.unsupported,
  origin: z.enum(['model', 'template']),
});
export type Checklist = z.infer<typeof ChecklistSchema>;

/** Score parts. `robustness` feeds the total but has no owner-facing group. */
export const SCORE_PARTS = [
  'dataAccuracy',
  'stateHandling',
  'request',
  'visual',
  'clarity',
  'a11y',
  'robustness',
] as const;
export type ScorePart = (typeof SCORE_PARTS)[number];

export const SCORE_WEIGHTS = {
  dataAccuracy: 20,
  stateHandling: 15,
  request: 15,
  visual: 20,
  clarity: 10,
  a11y: 10,
  robustness: 10,
} as const satisfies Record<ScorePart, number>;

export const SCORE_GROUPS = ['works', 'looks', 'request', 'easy'] as const;
export type ScoreGroup = (typeof SCORE_GROUPS)[number];
export const GROUP_OF: Record<ScorePart, ScoreGroup | null> = {
  dataAccuracy: 'works',
  stateHandling: 'works',
  visual: 'looks',
  a11y: 'looks',
  request: 'request',
  clarity: 'easy',
  robustness: null,
};

export const GATES = ['validOutput', 'boots', 'usesRealData', 'safe'] as const;
export type GateName = (typeof GATES)[number];

const Pts = z.strictObject({ points: z.number().min(0), max: z.number().min(0) });

export const CandidateScoreSchema = z.strictObject({
  total: z.number().int().min(0).max(100),
  parts: z.partialRecord(
    z.enum(SCORE_PARTS),
    z.strictObject({
      points: z.number().min(0),
      max: z.number().min(0),
      det: z.number().min(0),
      judge: z.number().min(0),
    }),
  ),
  groups: z.strictObject({ works: Pts, looks: Pts, request: Pts, easy: Pts }),
  gates: z.array(
    z.strictObject({
      gate: z.enum(GATES),
      passed: z.boolean(),
      detail: z.string().max(300),
    }),
  ),
  checklist: z.array(
    z.strictObject({
      id: z.string(),
      passed: z.boolean().nullable(),
      points: z.number().min(0),
      evidence: z.string().max(300),
    }),
  ),
  judge: z.strictObject({
    status: z.enum(['judged', 'unjudged', 'not_run']),
    reason: z.string().max(200).nullable(),
  }),
  eligible: z.boolean(),
});
export type CandidateScore = z.infer<typeof CandidateScoreSchema>;

export const CandidateIdSchema = z.string().regex(/^c[0-9]$/);

export const RankedEntrySchema = z.strictObject({
  candidateId: CandidateIdSchema,
  rank: z.number().int().min(1),
  topPick: z.boolean(),
  total: z.number().int(),
  groups: CandidateScoreSchema.shape.groups,
  direction: z.strictObject({ id: z.string(), label: z.string() }),
});
export type RankedEntry = z.infer<typeof RankedEntrySchema>;

export const VariantsRankingSchema = z.strictObject({
  top: z.array(RankedEntrySchema).max(2),
  others: z.array(z.strictObject({ candidateId: z.string(), total: z.number().int() })),
  reasons: z.array(z.string()).max(10),
});
export type VariantsRanking = z.infer<typeof VariantsRankingSchema>;
