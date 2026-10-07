# FV-1 — Contracts, services and data (as built)

The frontend compiles against the synced variants contracts. Typed access to the two routes and to staged candidate files is in place.

## Contracts

`frontend/src/contracts/` includes `variants.ts` and the variants fields on `sse.ts`, `api.ts`, `errors.ts`, `firestore-docs.ts`, and `limits.ts`. These files are generated from `functions/src/contracts/`. Do not edit them by hand. Run `npm run contracts:sync` at the repo root after a backend contract change.

`generation.started` carries `mode` and optional `fallbackReason`. The stream events the client handles are `variants.phase`, `candidate.progress`, and `variants.ready`. `variants.ready` ends the SSE stream. It does not emit the generation store's `end` bus event, because `awaiting_selection` is not a terminal status.

## API

`frontend/src/services/api/variants.api.ts`

- `getVariantsResult(projectId, generationId)` → `GET /v1/projects/:projectId/generations/:generationId/variants`
- `selectCandidate(projectId, generationId, candidateId)` → `POST …/variants/select` with `{ candidateId }`

The comment on `selectCandidate` records that a repeat select of the same option returns the stored snapshot.

Discard does not have its own client function. `variants.store` calls the existing `discardGeneration` (`POST …/discard`).

## Candidate files

`frontend/src/services/firestore/variants.repo.ts` reads `generations/{gid}/candidates/{cid}/staged` once with `getDocs`. Each doc becomes `{ path, op, content, language }`. `delete` ops carry empty content. The list is ordered by path.

`frontend/src/features/variants/candidate-files.ts` exports `overlayOps(base, ops)`. A `write` replaces or adds a path. A `delete` removes it. The result is sorted by path. The preview uses this overlay, so what the owner sees is the project's current files plus that option.

## Rules

Owner read of the project subtree already covers `candidates/**`. The client does not write those docs.
