import { getDocs, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { toMillis } from "@/lib/time";
import type { GenerationSnapshot } from "@/features/workspace/stores/generation.reducer";
import { refs } from "./paths";
import type { Generation } from "./types";

export function toGenerationSnapshot(g: Generation): GenerationSnapshot {
  const unresolved =
    g.partial !== null &&
    g.partial.appliedAt === null &&
    g.partial.discardedAt === null;
  return {
    id: g.id,
    status: g.status,
    prompt: g.prompt,
    error: g.error,
    partial:
      unresolved && g.partial
        ? { stagedPaths: g.partial.stagedPaths, applyable: g.partial.applyable }
        : null,
    result: g.result
      ? {
          snapshotId: g.result.snapshotId,
          snapshotSeq: g.result.snapshotSeq,
          changedPaths: g.result.changedPaths,
          deletedPaths: g.result.deletedPaths,
          rejected: g.result.rejected,
          noChanges: g.result.noChanges,
        }
      : null,
    heartbeatAtMs: toMillis(g.heartbeatAt),
  };
}

export async function fetchLatestGeneration(
  uid: string,
  projectId: string,
): Promise<GenerationSnapshot | null> {
  const snap = await getDocs(
    query(
      refs.generations(uid, projectId),
      orderBy("createdAt", "desc"),
      limit(1),
    ),
  );
  const first = snap.docs[0];
  return first ? toGenerationSnapshot(first.data()) : null;
}

export interface GenerationWatcher {
  next(snapshot: GenerationSnapshot | null): void;
  error(error: Error): void;
}

export function watchGeneration(
  uid: string,
  projectId: string,
  generationId: string,
  w: GenerationWatcher,
): () => void {
  return onSnapshot(
    refs.generation(uid, projectId, generationId),
    (snap) => w.next(snap.exists() ? toGenerationSnapshot(snap.data()) : null),
    (error) => w.error(error),
  );
}
