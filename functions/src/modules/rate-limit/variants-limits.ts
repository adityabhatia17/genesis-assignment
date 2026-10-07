import type { RuntimeConfig } from '../../config/runtime-config.js';
import type { RateLimitRule } from './rate-limiter.js';

const MINUTE = 60_000;
export const GLOBAL_SUBJECT = 'global';

export function variantsRules(
  c: Pick<RuntimeConfig, 'variantsUserPer10Min' | 'variantsUserPerDay' | 'variantsGlobalPerDay'>,
): { burst: RateLimitRule; day: RateLimitRule; global: RateLimitRule } {
  return {
    burst: { name: 'variantsBurst', limit: c.variantsUserPer10Min, windowMs: 10 * MINUTE },
    day: { name: 'variantsDay', limit: c.variantsUserPerDay, windowMs: 24 * 60 * MINUTE },
    global: { name: 'variantsGlobalDay', limit: c.variantsGlobalPerDay, windowMs: 24 * 60 * MINUTE },
  };
}
