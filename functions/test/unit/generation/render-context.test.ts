import {
  buildHistory,
  renderUserTurn,
  selectFilesWithinBudget,
} from '../../../src/modules/generation/context/render-context.js';

const m = (
  role: 'user' | 'assistant' | 'system',
  content: string,
  generationId: string | null,
  meta: Record<string, unknown> | null = null,
  t = 1,
) => ({ role, content, generationId, meta, createdAtMs: t });

describe('buildHistory', () => {
  it('excludes the current generation, annotates changes, alternates roles', () => {
    const { turns, notes } = buildHistory(
      [
        m('assistant', 'orphan', 'g0', null, 1),
        m('user', 'Build a dashboard', 'g1', null, 2),
        m(
          'assistant',
          'Built it.',
          'g1',
          { changedPaths: ['index.html', 'app.js'], status: 'completed' },
          3,
        ),
        m('system', 'Restored history #1.', null, null, 4),
        m('user', 'Add search', 'g2', null, 5),
        m('assistant', 'Partial.', 'g2', { status: 'interrupted' }, 6),
        m('user', 'Add search please', 'g3', null, 7), // current generation
      ],
      'g3',
    );
    expect(turns).toEqual([
      { role: 'user', content: 'Build a dashboard' },
      { role: 'assistant', content: 'Built it.\n\n[Files changed: index.html, app.js]' },
      { role: 'user', content: 'Add search' },
      { role: 'assistant', content: 'Partial.\n\n[Generation interrupted]' },
    ]);
    expect(notes).toEqual(['1970-01-01T00:00:00.004Z: Restored history #1.']);
  });
});

describe('selectFilesWithinBudget', () => {
  it('keeps index.html and newest files first when over budget', () => {
    const f = (path: string, sizeBytes: number, updatedAtMs: number) => ({
      path,
      sizeBytes,
      updatedAtMs,
      content: '',
      fileId: path,
      contentHash: '',
      version: 1,
      language: 'javascript' as const,
    });
    const out = selectFilesWithinBudget(
      [f('index.html', 50, 1), f('a.js', 60, 2), f('b.js', 60, 3)],
      120,
    );
    expect(out.included.map((x) => x.path)).toEqual(['index.html', 'b.js']);
    expect(out.omitted).toEqual([{ path: 'a.js', bytes: 60 }]);
  });
});

describe('renderUserTurn', () => {
  it('wraps data in tags and includes the request last', () => {
    const text = renderUserTurn({
      projectName: 'Demo',
      projectDescription: '',
      notes: [],
      omitted: [],
      files: [{ path: 'index.html', sizeBytes: 5, content: '<p/>' }],
      hl: {
        status: 'connected',
        locationName: 'Clinic',
        timezone: 'America/New_York',
        calendars: ['Consults'],
        contactsTotal: 36,
        availableMethods: ['contacts.list'],
        note: null,
      },
      prompt: 'Add a footer',
    });
    expect(text).toMatch(
      /<highlevel_context>[\s\S]*Location: Clinic \(timezone America\/New_York\)[\s\S]*Calendars \(1\): Consults[\s\S]*<\/highlevel_context>/,
    );
    expect(text).toContain('<file path="index.html" bytes="5">\n<p/>\n</file>');
    expect(text.trim().endsWith('<request>\nAdd a footer\n</request>')).toBe(true);
  });
  it('explains empty projects and missing connections', () => {
    const text = renderUserTurn({
      projectName: 'New',
      projectDescription: '',
      notes: [],
      omitted: [],
      files: [],
      prompt: 'x',
      hl: {
        status: 'disconnected',
        locationName: null,
        timezone: null,
        calendars: [],
        contactsTotal: null,
        availableMethods: [],
        note: 'HighLevel is not connected yet.',
      },
    });
    expect(text).toContain('No files yet');
    expect(text).toContain('HighLevel is not connected yet');
  });
});
