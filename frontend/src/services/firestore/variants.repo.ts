import { getDocs } from 'firebase/firestore';
import type { CandidateOp } from '@/features/variants/candidate-files';
import { refs } from './paths';

export class CandidateFilesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CandidateFilesError';
  }
}

/** One-time read. Candidate files do not change after ranking, so there is no listener. */
export async function fetchCandidateOps(
  uid: string,
  projectId: string,
  generationId: string,
  candidateId: string,
): Promise<CandidateOp[]> {
  const snap = await getDocs(refs.candidateStaged(uid, projectId, generationId, candidateId));
  const ops: CandidateOp[] = [];
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (data.op !== 'write' && data.op !== 'delete') {
      throw new CandidateFilesError('A staged file has an unexpected shape.');
    }
    if (typeof data.path !== 'string' || (data.op === 'write' && typeof data.content !== 'string')) {
      throw new CandidateFilesError('A staged file is missing its contents.');
    }
    ops.push({
      path: data.path,
      op: data.op,
      content: data.op === 'delete' ? '' : (data.content ?? ''),
    });
  }
  ops.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return ops;
}
