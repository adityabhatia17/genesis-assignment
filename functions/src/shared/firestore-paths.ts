const project = (uid: string, pid: string) => `users/${uid}/projects/${pid}`;

export const paths = {
  integration: (uid: string) => `users/${uid}/integrations/highlevel`,
  events: (uid: string) => `users/${uid}/events`,
  userEvent: (uid: string, eventId: string) => `users/${uid}/events/${eventId}`,
  webhookEvent: (webhookId: string) => `webhookEvents/${webhookId}`,
  project,
  projects: (uid: string) => `users/${uid}/projects`,
  files: (uid: string, pid: string) => `${project(uid, pid)}/files`,
  file: (uid: string, pid: string, fileId: string) => `${project(uid, pid)}/files/${fileId}`,
  messages: (uid: string, pid: string) => `${project(uid, pid)}/messages`,
  generations: (uid: string, pid: string) => `${project(uid, pid)}/generations`,
  generation: (uid: string, pid: string, gid: string) => `${project(uid, pid)}/generations/${gid}`,
  staged: (uid: string, pid: string, gid: string) =>
    `${project(uid, pid)}/generations/${gid}/staged`,
  rawArtifact: (uid: string, pid: string, gid: string) =>
    `${project(uid, pid)}/generations/${gid}/artifacts/raw`,
  snapshots: (uid: string, pid: string) => `${project(uid, pid)}/snapshots`,
  snapshot: (uid: string, pid: string, sid: string) => `${project(uid, pid)}/snapshots/${sid}`,
  blob: (uid: string, pid: string, sha: string) => `${project(uid, pid)}/blobs/${sha}`,
  connection: (uid: string) => `hlConnections/${uid}`,
  connections: () => 'hlConnections',
  oauthState: (hash: string) => `oauthStates/${hash}`,
  rateLimit: (id: string) => `rateLimits/${id}`,
  budgetDay: (key: string) => `rateLimits/variantsBudget_${key}`,
  candidates: (uid: string, pid: string, gid: string) =>
    `${project(uid, pid)}/generations/${gid}/candidates`,
  candidate: (uid: string, pid: string, gid: string, cid: string) =>
    `${project(uid, pid)}/generations/${gid}/candidates/${cid}`,
  candidateStaged: (uid: string, pid: string, gid: string, cid: string) =>
    `${project(uid, pid)}/generations/${gid}/candidates/${cid}/staged`,
} as const;
