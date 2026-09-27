import type { z } from 'zod';
import type { ApplyResult, CancelResult, DiscardResult } from '@/contracts/api';
import { apiFetch } from '@/lib/http';

const base = (projectId: string, generationId: string) =>
  `/v1/projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generationId)}`;

export function applyGeneration(projectId: string, generationId: string): Promise<ApplyResult> {
  return apiFetch('api', `${base(projectId, generationId)}/apply`, {
    method: 'POST',
    body: {},
  });
}

export function cancelGeneration(projectId: string, generationId: string): Promise<CancelResult> {
  return apiFetch('api', `${base(projectId, generationId)}/cancel`, {
    method: 'POST',
    body: {},
  });
}

export function discardGeneration(
  projectId: string,
  generationId: string,
): Promise<z.infer<typeof DiscardResult>> {
  return apiFetch('api', `${base(projectId, generationId)}/discard`, {
    method: 'POST',
    body: {},
  });
}
