import { HlApiError } from '../../../src/modules/highlevel/client/hl-errors.js';
import type { AccessGrant } from '../../../src/modules/highlevel/connection/token-manager.js';
import { RuntimeService } from '../../../src/modules/highlevel/runtime/runtime.service.js';
import type {
  ProjectAccessPort,
  ProjectRecord,
} from '../../../src/modules/projects/project-access.js';
import { AppError } from '../../../src/shared/app-error.js';
import { fakeLogger, InMemoryConnectionRepo } from '../../helpers/fakes.js';

const project = (over: Partial<ProjectRecord> = {}): ProjectRecord => ({
  id: 'p1',
  name: 'P',
  status: 'active',
  locationId: 'loc_1',
  activeGeneration: null,
  workingTreeDirty: false,
  latestSnapshotId: null,
  snapshotSeq: 0,
  fileCount: 0,
  totalBytes: 0,
  ...over,
});

function setup(
  opts: {
    project?: ProjectRecord;
    handler?: (token: string) => Promise<unknown>;
    scopes?: string[];
  } = {},
) {
  const bound: string[] = [];
  const projects: ProjectAccessPort = {
    getOwnedActive: () => Promise.resolve(opts.project ?? project()),
    bindLocation: (_u, _p, loc) => {
      bound.push(loc);
      return Promise.resolve();
    },
  };
  let n = 0;
  const grant = (token: string): AccessGrant => ({
    accessToken: token,
    locationId: 'loc_1',
    expiresAtMs: 1_000,
    scopes: opts.scopes ?? [],
  });
  const tokens = {
    getAccessGrant: vi.fn(() => Promise.resolve(grant('t0'))),
    forceRefresh: vi.fn(() => {
      n += 1;
      return Promise.resolve(grant(`t${n}`));
    }),
    markReauth: vi.fn(() => Promise.resolve(new AppError('HL_REAUTH_REQUIRED'))),
  };
  const handler = vi.fn((ctx: { accessToken: string }, _params: unknown) =>
    (opts.handler ?? (() => Promise.resolve({ ok: ctx.accessToken })))(ctx.accessToken),
  );
  const service = new RuntimeService({
    projects,
    tokens,
    connections: new InMemoryConnectionRepo(),
    hl: { request: () => Promise.resolve(null) },
    handlers: { 'contacts.list': handler, 'calendars.events': handler },
  });
  return { service, tokens, handler, bound };
}

describe('RuntimeService', () => {
  it('invokes the handler with validated params', async () => {
    const s = setup();
    await expect(
      s.service.invoke('u', 'p1', 'contacts.list', { limit: '5' }, fakeLogger()),
    ).resolves.toEqual({
      ok: 't0',
    });
    expect(s.handler.mock.calls[0]![1]).toEqual({ limit: 5 });
  });
  it('rejects invalid params', async () => {
    await expect(
      setup().service.invoke('u', 'p1', 'contacts.list', { limit: 999 }, fakeLogger()),
    ).rejects.toThrow();
  });
  it('refuses a project bound to another location, binds when unbound', async () => {
    await expect(
      setup({ project: project({ locationId: 'other' }) }).service.invoke(
        'u',
        'p1',
        'contacts.list',
        {},
        fakeLogger(),
      ),
    ).rejects.toMatchObject({ code: 'PROJECT_LOCATION_MISMATCH' });
    const s = setup({ project: project({ locationId: null }) });
    await s.service.invoke('u', 'p1', 'contacts.list', {}, fakeLogger());
    expect(s.bound).toEqual(['loc_1']);
  });
  it('refreshes once on 401 and retries', async () => {
    let calls = 0;
    const s = setup({
      handler: (token) => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new HlApiError(401, 'expired', null, null))
          : Promise.resolve({ token });
      },
    });
    await expect(s.service.invoke('u', 'p1', 'contacts.list', {}, fakeLogger())).resolves.toEqual({
      token: 't1',
    });
    expect(s.tokens.forceRefresh).toHaveBeenCalledTimes(1);
  });
  it('marks reauth after a second 401', async () => {
    const s = setup({
      handler: () => Promise.reject(new HlApiError(401, 'expired', null, null)),
    });
    await expect(
      s.service.invoke('u', 'p1', 'contacts.list', {}, fakeLogger()),
    ).rejects.toMatchObject({
      code: 'HL_REAUTH_REQUIRED',
    });
    expect(s.tokens.markReauth).toHaveBeenCalled();
  });
  it('maps other HighLevel errors', async () => {
    const s = setup({
      handler: () => Promise.reject(new HlApiError(429, 'slow down', null, 1_000)),
    });
    await expect(
      s.service.invoke('u', 'p1', 'contacts.list', {}, fakeLogger()),
    ).rejects.toMatchObject({
      code: 'HL_RATE_LIMITED',
    });
  });
  it('checks granted scopes when known', async () => {
    const s = setup({ scopes: ['contacts.readonly'] });
    await expect(
      s.service.invoke(
        'u',
        'p1',
        'calendars.events',
        { from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' },
        fakeLogger(),
      ),
    ).rejects.toMatchObject({
      code: 'HL_SCOPE_MISSING',
    });
  });
});
