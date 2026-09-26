# BE-7 — Manual file save and snapshot restore

> Read [`00-overview.md`](00-overview.md) first. Design: [`../05-backend-system-design.md`](../05-backend-system-design.md) §9. Flows: [`../07-end-to-end-system-design.md`](../07-end-to-end-system-design.md) §4.10–4.11. Contracts: A12, A13.

**Outcome:** users save manual edits with optimistic concurrency (version check), blocked during an active generation; any snapshot can be restored without losing unsnapshotted edits (checkpoint first), producing a new append-only `restore` snapshot.

---

### Task BE-7.1: Manual file save

**Files:**

- Create: `functions/src/modules/files/file-save.service.ts`, `functions/src/modules/files/files.routes.ts`
- Modify: `functions/src/composition.ts`
- Test: `functions/test/integration/files/file-save.test.ts`

**Interfaces:**

- Consumes: `toProjectRecord`, `isLeaseStale`, `LIMITS`, `sha256Hex`, `utf8Bytes`, contracts `FileSaveParams`, `FileSaveBody`, `FileSaveResult`.
- Produces: `class FileSaveService { save(uid, projectId, fileId, content, expectedVersion): Promise<FileSaveResult> }`, `filesRouter(service, limiter)` → `PUT /v1/projects/:projectId/files/:fileId`.

- [ ] **Step 1: Write the failing integration tests**

```ts
import { Timestamp } from "firebase-admin/firestore";
import { FileSaveService } from "../../../src/modules/files/file-save.service.js";
import { firestore } from "../../../src/shared/firebase-admin.js";
import { createFakeClock } from "../../../src/shared/clock.js";
import { sha256Hex } from "../../../src/shared/hash.js";

const db = firestore();
const NOW = Date.parse("2026-10-01T12:00:00Z");
const svc = new FileSaveService(db, createFakeClock(NOW));
const FID = "a".repeat(20);

async function seed(pid: string, project: Record<string, unknown> = {}) {
  const t = Timestamp.fromMillis(NOW);
  await db
    .doc(`users/u/projects/${pid}`)
    .set({
      name: "P",
      description: "",
      locationId: null,
      status: "active",
      createdAt: t,
      updatedAt: t,
      deletedAt: null,
      totalBytes: 5,
      fileCount: 1,
      ...project,
    });
  await db
    .doc(`users/u/projects/${pid}/files/${FID}`)
    .set({
      path: "app.js",
      language: "javascript",
      content: "var a",
      sizeBytes: 5,
      contentHash: sha256Hex("var a"),
      version: 3,
      source: "ai",
      updatedAt: t,
      lastGenerationId: "g",
    });
}

describe("FileSaveService", () => {
  it("saves with the expected version, bumps version and marks the tree dirty", async () => {
    await seed("p1");
    const r = await svc.save("u", "p1", FID, "var a = 1;", 3);
    expect(r).toMatchObject({
      fileId: FID,
      path: "app.js",
      version: 4,
      sizeBytes: 10,
    });
    const p = await db.doc("users/u/projects/p1").get();
    expect(p.get("workingTreeDirty")).toBe(true);
    expect(p.get("totalBytes")).toBe(10);
    expect(
      (await db.doc(`users/u/projects/p1/files/${FID}`).get()).get("source"),
    ).toBe("manual");
  });
  it("rejects a stale version with the current version in details", async () => {
    await seed("p2");
    await expect(svc.save("u", "p2", FID, "x", 2)).rejects.toMatchObject({
      code: "FILE_VERSION_CONFLICT",
      details: { currentVersion: 3 },
    });
  });
  it("is a no-op for identical content", async () => {
    await seed("p3");
    expect((await svc.save("u", "p3", FID, "var a", 3)).version).toBe(3);
  });
  it("blocks saves during a live generation but not a stale one", async () => {
    const live = Timestamp.fromMillis(NOW);
    await seed("p4", {
      activeGeneration: { id: "g", startedAt: live, heartbeatAt: live },
    });
    await expect(svc.save("u", "p4", FID, "x", 3)).rejects.toMatchObject({
      code: "GENERATION_IN_PROGRESS",
    });
    const old = Timestamp.fromMillis(NOW - 120_000);
    await seed("p5", {
      activeGeneration: { id: "g", startedAt: old, heartbeatAt: old },
    });
    await expect(svc.save("u", "p5", FID, "x", 3)).resolves.toMatchObject({
      version: 4,
    });
  });
  it("enforces size limits and existence", async () => {
    await seed("p6");
    await expect(
      svc.save("u", "p6", FID, "é".repeat(60_000), 3),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      svc.save("u", "p6", "b".repeat(20), "x", 1),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    await expect(svc.save("u", "nope", FID, "x", 1)).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND",
    });
  });
});
```

- [ ] **Step 2: Implement `file-save.service.ts`**

```ts
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { FileSaveResult } from "../../contracts/api.js";
import { LIMITS } from "../../contracts/limits.js";
import { AppError } from "../../shared/app-error.js";
import type { Clock } from "../../shared/clock.js";
import { paths } from "../../shared/firestore-paths.js";
import { sha256Hex, utf8Bytes } from "../../shared/hash.js";
import { isLeaseStale, toProjectRecord } from "../projects/project-access.js";

export class FileSaveService {
  constructor(
    private readonly db: Firestore,
    private readonly clock: Clock,
  ) {}

  save(
    uid: string,
    projectId: string,
    fileId: string,
    content: string,
    expectedVersion: number,
  ): Promise<FileSaveResult> {
    const projectRef = this.db.doc(paths.project(uid, projectId));
    const fileRef = this.db.doc(paths.file(uid, projectId, fileId));
    return this.db.runTransaction(async (tx) => {
      const [projectSnap, fileSnap] = await tx.getAll(projectRef, fileRef);
      if (!projectSnap?.exists || projectSnap.get("status") !== "active")
        throw new AppError("PROJECT_NOT_FOUND");
      const project = toProjectRecord(projectSnap.id, projectSnap.data());
      const nowMs = this.clock.now();
      if (
        project.activeGeneration &&
        !isLeaseStale(project.activeGeneration, nowMs)
      ) {
        throw new AppError("GENERATION_IN_PROGRESS", undefined, {
          activeGenerationId: project.activeGeneration.id,
        });
      }
      if (!fileSnap?.exists) throw new AppError("FILE_NOT_FOUND");
      const version = fileSnap.get("version") as number;
      if (version !== expectedVersion)
        throw new AppError("FILE_VERSION_CONFLICT", undefined, {
          currentVersion: version,
        });

      const path = fileSnap.get("path") as string;
      const oldBytes = fileSnap.get("sizeBytes") as number;
      const sizeBytes = utf8Bytes(content);
      if (sizeBytes > LIMITS.maxFileBytes)
        throw new AppError(
          "VALIDATION_FAILED",
          `Files are limited to ${LIMITS.maxFileBytes} bytes.`,
        );
      if (content.includes("\u0000"))
        throw new AppError(
          "VALIDATION_FAILED",
          "File contains a NUL character.",
        );
      const totalBytes = project.totalBytes - oldBytes + sizeBytes;
      if (totalBytes > LIMITS.maxProjectBytes)
        throw new AppError(
          "VALIDATION_FAILED",
          `Projects are limited to ${LIMITS.maxProjectBytes} bytes.`,
        );

      const contentHash = sha256Hex(content);
      if (contentHash === fileSnap.get("contentHash"))
        return { fileId, path, version, sizeBytes: oldBytes, contentHash };

      const now = Timestamp.fromMillis(nowMs);
      tx.update(fileRef, {
        content,
        sizeBytes,
        contentHash,
        version: version + 1,
        source: "manual",
        updatedAt: now,
      });
      tx.update(projectRef, {
        workingTreeDirty: true,
        totalBytes,
        updatedAt: now,
      });
      return { fileId, path, version: version + 1, sizeBytes, contentHash };
    });
  }
}
```

- [ ] **Step 3: Implement `files.routes.ts`**

```ts
import express, { type Router } from "express";
import { FileSaveBody, FileSaveParams } from "../../contracts/api.js";
import { defineHandler, requireUid } from "../../http/define-handler.js";
import { rateLimit } from "../../http/middleware/rate-limit.js";
import { sendData } from "../../http/respond.js";
import { RATE_LIMITS, type RateLimiter } from "../rate-limit/rate-limiter.js";
import type { FileSaveService } from "./file-save.service.js";

export function filesRouter(
  service: FileSaveService,
  limiter: RateLimiter,
): Router {
  const r = express.Router();
  r.put(
    "/v1/projects/:projectId/files/:fileId",
    rateLimit(limiter, RATE_LIMITS.fileSave),
    defineHandler(
      { params: FileSaveParams, body: FileSaveBody },
      async ({ params, body }, req, res) => {
        sendData(
          res,
          await service.save(
            requireUid(req),
            params.projectId,
            params.fileId,
            body.content,
            body.expectedVersion,
          ),
        );
      },
    ),
  );
  return r;
}
```

- [ ] **Step 4: Wire** — in `buildApiApp`: `authedRouters.push(filesRouter(new FileSaveService(db, clock), limiter));`

- [ ] **Step 5: Run integration tests → PASS; commit** — `feat(functions): add manual file save with optimistic concurrency`.

---

### Task BE-7.2: Snapshot restore

**Files:**

- Create: `functions/src/modules/snapshots/restore.service.ts`, `functions/src/modules/snapshots/snapshots.routes.ts`
- Modify: `functions/src/composition.ts`
- Test: `functions/test/integration/snapshots/restore.test.ts`

**Interfaces:**

- Consumes: `BlobsRepo.readMany`, `CommitService.applyTreeChange` (with `replaceTree: true`, `source: 'restore'`, `snapshot.kind: 'restore'`, `lease: must-be-free`, `precondition`), contracts `RestoreParams`, `RestoreResult`.
- Produces: `class RestoreService { restore(uid, projectId, snapshotId): Promise<RestoreResult> }`, `snapshotsRouter(service, limiter)` → `POST /v1/projects/:projectId/snapshots/:snapshotId/restore`.

- [ ] **Step 1: Write the failing integration tests**

```ts
import { Timestamp } from "firebase-admin/firestore";
import { CommitService } from "../../../src/modules/generation/persistence/commit.service.js";
import {
  validateWrite,
  type FileOp,
} from "../../../src/modules/generation/validation/validate-file.js";
import {
  DEMO_APP_JS,
  DEMO_INDEX_HTML,
  DEMO_STYLES_CSS,
} from "../../../src/modules/generation/llm/fake-scripts.js";
import { BlobsRepo } from "../../../src/modules/snapshots/blobs.repo.js";
import { RestoreService } from "../../../src/modules/snapshots/restore.service.js";
import { firestore } from "../../../src/shared/firebase-admin.js";
import { createFakeClock } from "../../../src/shared/clock.js";

const db = firestore();
const blobs = new BlobsRepo(db);
const commits = new CommitService(db, blobs);
const clock = createFakeClock(Date.parse("2026-10-01T12:00:00Z"));
const restore = new RestoreService(db, blobs, commits, clock);
const op = (p: string, c: string) => validateWrite(p, c).op as FileOp;
const commit = (pid: string, ops: FileOp[]) =>
  commits.applyTreeChange({
    uid: "u",
    projectId: pid,
    nowMs: clock.now(),
    ops,
    source: "ai",
    validateNextTree: false,
    messages: [],
    snapshot: {
      kind: "generation",
      label: "x",
      generationId: null,
      restoredFromSnapshotId: null,
    },
    lease: { mode: "must-be-free" },
  });
const paths = async (pid: string) =>
  (await db.collection(`users/u/projects/${pid}/files`).get()).docs
    .map((d) => d.get("path") as string)
    .sort();

async function seed(pid: string) {
  const t = Timestamp.fromMillis(clock.now());
  await db
    .doc(`users/u/projects/${pid}`)
    .set({
      name: "P",
      description: "",
      locationId: null,
      status: "active",
      createdAt: t,
      updatedAt: t,
      deletedAt: null,
    });
  const s1 = await commit(pid, [
    op("index.html", DEMO_INDEX_HTML),
    op("styles.css", DEMO_STYLES_CSS),
    op("app.js", DEMO_APP_JS),
  ]);
  const s2 = await commit(pid, [
    op("extra.js", "var extra = 1;"),
    op("app.js", `${DEMO_APP_JS}\n// v2`),
  ]);
  return { s1, s2 };
}

describe("RestoreService", () => {
  it("restores files, removes extras and appends a restore snapshot", async () => {
    const { s1 } = await seed("r1");
    const r = await restore.restore("u", "r1", s1.snapshotId);
    expect(r).toMatchObject({
      snapshotSeq: 3,
      restoredFromSnapshotId: s1.snapshotId,
      checkpointSnapshotId: null,
    });
    expect(await paths("r1")).toEqual(["app.js", "index.html", "styles.css"]);
    const snap = await db
      .doc(`users/u/projects/r1/snapshots/${r.snapshotId}`)
      .get();
    expect(snap.get("kind")).toBe("restore");
    expect(snap.get("deletedPaths")).toEqual(["extra.js"]);
  });
  it("checkpoints unsnapshotted edits before restoring", async () => {
    const { s1 } = await seed("r2");
    await db.doc("users/u/projects/r2").update({ workingTreeDirty: true });
    const r = await restore.restore("u", "r2", s1.snapshotId);
    expect(r.checkpointSnapshotId).not.toBeNull();
    expect(r.snapshotSeq).toBe(4);
  });
  it("refuses to restore the current clean snapshot and unknown ids", async () => {
    const { s2 } = await seed("r3");
    await expect(
      restore.restore("u", "r3", s2.snapshotId),
    ).rejects.toMatchObject({ code: "SNAPSHOT_ALREADY_CURRENT" });
    await expect(restore.restore("u", "r3", "missing")).rejects.toMatchObject({
      code: "SNAPSHOT_NOT_FOUND",
    });
  });
  it("refuses while a generation is live", async () => {
    const { s1 } = await seed("r4");
    const t = Timestamp.fromMillis(clock.now());
    await db
      .doc("users/u/projects/r4")
      .update({ activeGeneration: { id: "g", startedAt: t, heartbeatAt: t } });
    await expect(
      restore.restore("u", "r4", s1.snapshotId),
    ).rejects.toMatchObject({ code: "GENERATION_IN_PROGRESS" });
  });
});
```

- [ ] **Step 2: Implement `restore.service.ts`**

```ts
import type { Firestore } from "firebase-admin/firestore";
import type { RestoreResult } from "../../contracts/api.js";
import type { SnapshotFileEntry } from "../../contracts/firestore-docs.js";
import { AppError } from "../../shared/app-error.js";
import type { Clock } from "../../shared/clock.js";
import { paths } from "../../shared/firestore-paths.js";
import type { CommitService } from "../generation/persistence/commit.service.js";
import type { FileOp } from "../generation/validation/validate-file.js";
import type { BlobsRepo } from "./blobs.repo.js";

export class RestoreService {
  constructor(
    private readonly db: Firestore,
    private readonly blobs: BlobsRepo,
    private readonly commits: CommitService,
    private readonly clock: Clock,
  ) {}

  async restore(
    uid: string,
    projectId: string,
    snapshotId: string,
  ): Promise<RestoreResult> {
    const snap = await this.db
      .doc(paths.snapshot(uid, projectId, snapshotId))
      .get();
    if (!snap.exists) throw new AppError("SNAPSHOT_NOT_FOUND");
    const seq = snap.get("seq") as number;
    const manifest = Object.values(
      snap.get("files") as Record<string, SnapshotFileEntry>,
    );
    const contents = await this.blobs.readMany(
      uid,
      projectId,
      manifest.map((e) => e.blobId),
    );

    const ops: FileOp[] = manifest.map((e) => ({
      op: "write",
      path: e.path,
      content: contents.get(e.blobId) ?? "",
      sizeBytes: e.sizeBytes,
      sha256: e.blobId,
      language: e.language,
    }));

    const result = await this.commits.applyTreeChange({
      uid,
      projectId,
      nowMs: this.clock.now(),
      ops,
      replaceTree: true,
      source: "restore",
      validateNextTree: false,
      snapshot: {
        kind: "restore",
        label: `Restored #${seq}`,
        generationId: null,
        restoredFromSnapshotId: snapshotId,
      },
      lease: { mode: "must-be-free" },
      precondition: (p) => {
        if (p.latestSnapshotId === snapshotId && !p.workingTreeDirty)
          throw new AppError("SNAPSHOT_ALREADY_CURRENT");
      },
      messages: [
        {
          role: "system",
          content: `Restored snapshot #${seq}.`,
          generationId: null,
          meta: null,
        },
      ],
    });
    return {
      snapshotId: result.snapshotId,
      snapshotSeq: result.snapshotSeq,
      restoredFromSnapshotId: snapshotId,
      checkpointSnapshotId: result.checkpointSnapshotId,
    };
  }
}
```

- [ ] **Step 3: Implement `snapshots.routes.ts`**

```ts
import express, { type Router } from "express";
import { RestoreParams } from "../../contracts/api.js";
import { defineHandler, requireUid } from "../../http/define-handler.js";
import { rateLimit } from "../../http/middleware/rate-limit.js";
import { sendData } from "../../http/respond.js";
import { RATE_LIMITS, type RateLimiter } from "../rate-limit/rate-limiter.js";
import type { RestoreService } from "./restore.service.js";

export function snapshotsRouter(
  service: RestoreService,
  limiter: RateLimiter,
): Router {
  const r = express.Router();
  r.post(
    "/v1/projects/:projectId/snapshots/:snapshotId/restore",
    rateLimit(limiter, RATE_LIMITS.snapshotRestore),
    defineHandler({ params: RestoreParams }, async ({ params }, req, res) => {
      sendData(
        res,
        await service.restore(
          requireUid(req),
          params.projectId,
          params.snapshotId,
        ),
      );
    }),
  );
  return r;
}
```

- [ ] **Step 4: Wire** — in `buildApiApp`:

```ts
const blobs = new BlobsRepo(db);
const commits = new CommitService(db, blobs);
authedRouters.push(
  snapshotsRouter(new RestoreService(db, blobs, commits, clock), limiter),
);
```

(reuse the same `commits` instance for `generationControlRouter`).

- [ ] **Step 5: Run integration tests → PASS; commit** — `feat(functions): add append-only snapshot restore with checkpoints`.

---

### Task BE-7.3: API-level checks for save and restore

**Files:**

- Test: `functions/test/integration/api/files-snapshots.routes.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { Timestamp } from "firebase-admin/firestore";
import request from "supertest";
import { createHttpApp } from "../../../src/http/create-http-app.js";
import { FileSaveService } from "../../../src/modules/files/file-save.service.js";
import { filesRouter } from "../../../src/modules/files/files.routes.js";
import { CommitService } from "../../../src/modules/generation/persistence/commit.service.js";
import { MemoryRateLimiter } from "../../../src/modules/rate-limit/rate-limiter.js";
import { BlobsRepo } from "../../../src/modules/snapshots/blobs.repo.js";
import { RestoreService } from "../../../src/modules/snapshots/restore.service.js";
import { snapshotsRouter } from "../../../src/modules/snapshots/snapshots.routes.js";
import { systemClock } from "../../../src/shared/clock.js";
import { firestore } from "../../../src/shared/firebase-admin.js";
import { sha256Hex } from "../../../src/shared/hash.js";
import { fakeLogger } from "../../helpers/fakes.js";

const db = firestore();
const blobs = new BlobsRepo(db);
const limiter = new MemoryRateLimiter(systemClock);
const app = createHttpApp({
  service: "api",
  version: "t",
  allowedOrigins: [],
  logger: fakeLogger(),
  verifyIdToken: (t) => Promise.resolve({ uid: t }),
  authedRouters: [
    filesRouter(new FileSaveService(db, systemClock), limiter),
    snapshotsRouter(
      new RestoreService(db, blobs, new CommitService(db, blobs), systemClock),
      limiter,
    ),
  ],
});
const FID = "c".repeat(20);

beforeAll(async () => {
  const t = Timestamp.now();
  await db
    .doc("users/owner/projects/h1")
    .set({
      name: "P",
      description: "",
      locationId: null,
      status: "active",
      createdAt: t,
      updatedAt: t,
      deletedAt: null,
      totalBytes: 1,
    });
  await db
    .doc(`users/owner/projects/h1/files/${FID}`)
    .set({
      path: "app.js",
      language: "javascript",
      content: "x",
      sizeBytes: 1,
      contentHash: sha256Hex("x"),
      version: 1,
      source: "ai",
      updatedAt: t,
      lastGenerationId: null,
    });
});

describe("files and snapshots HTTP contracts", () => {
  it("validates params and body", async () => {
    const badId = await request(app)
      .put("/v1/projects/h1/files/not-a-file-id")
      .set("Authorization", "Bearer owner")
      .send({ content: "y", expectedVersion: 1 });
    expect(badId.status).toBe(400);
    expect(badId.body.error.code).toBe("VALIDATION_FAILED");
    const badVersion = await request(app)
      .put(`/v1/projects/h1/files/${FID}`)
      .set("Authorization", "Bearer owner")
      .send({ content: "y", expectedVersion: 0 });
    expect(badVersion.status).toBe(400);
  });

  it("scopes to the caller (another user sees 404)", async () => {
    const res = await request(app)
      .put(`/v1/projects/h1/files/${FID}`)
      .set("Authorization", "Bearer stranger")
      .send({ content: "y", expectedVersion: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PROJECT_NOT_FOUND");
  });

  it("saves, then reports conflicts with the current version", async () => {
    const ok = await request(app)
      .put(`/v1/projects/h1/files/${FID}`)
      .set("Authorization", "Bearer owner")
      .send({ content: "y", expectedVersion: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({
      fileId: FID,
      path: "app.js",
      version: 2,
    });
    const stale = await request(app)
      .put(`/v1/projects/h1/files/${FID}`)
      .set("Authorization", "Bearer owner")
      .send({ content: "z", expectedVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({
      code: "FILE_VERSION_CONFLICT",
      details: { currentVersion: 2 },
    });
  });

  it("returns 404 for an unknown snapshot", async () => {
    const res = await request(app)
      .post("/v1/projects/h1/snapshots/nope/restore")
      .set("Authorization", "Bearer owner")
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SNAPSHOT_NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run** — `npm run test:integration` → PASS. **Step 3: Commit** — `test(functions): cover save and restore HTTP contracts`.
