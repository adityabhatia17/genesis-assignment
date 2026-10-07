import type { SelectCandidateResult, VariantsResultDto } from '@/contracts/api';
import { apiFetch } from '@/lib/http';

const base = (projectId: string, generationId: string) =>
  `/v1/projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generationId)}`;

export function getVariantsResult(
  projectId: string,
  generationId: string,
): Promise<VariantsResultDto> {
  return apiFetch('api', `${base(projectId, generationId)}/variants`);
}

/**
 * Choosing the same option again returns the stored snapshot (the route is idempotent),
 * so a retry after a dropped response is safe.
 */
export function selectCandidate(
  projectId: string,
  generationId: string,
  candidateId: string,
): Promise<SelectCandidateResult> {
  return apiFetch('api', `${base(projectId, generationId)}/variants/select`, {
    method: 'POST',
    body: { candidateId },
  });
}
