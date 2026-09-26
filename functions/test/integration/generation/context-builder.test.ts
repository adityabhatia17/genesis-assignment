import { Timestamp } from 'firebase-admin/firestore';
import { ContextBuilder } from '../../../src/modules/generation/context/context-builder.js';
import { fileIdForPath } from '../../../src/shared/hash.js';
import { firestore } from '../../../src/shared/firebase-admin.js';
import type { HighLevelContext } from '../../../src/modules/highlevel/metadata/location-context.service.js';

const db = firestore();
const uid = 'u';
const projectId = 'p';

const connected: HighLevelContext = {
  status: 'connected',
  locationName: 'Clinic',
  timezone: 'America/New_York',
  calendars: ['Consults'],
  contactsTotal: 36,
  availableMethods: ['contacts.list'],
  note: null,
};

async function clearProject(): Promise<void> {
  const batch = db.batch();
  for (const col of ['files', 'messages'] as const) {
    const snap = await db.collection(`users/${uid}/projects/${projectId}/${col}`).get();
    for (const d of snap.docs) batch.delete(d.ref);
  }
  await batch.commit();
}

describe('ContextBuilder', () => {
  beforeEach(async () => {
    await clearProject();
  });

  it('builds bounded context', async () => {
    await db.doc(`users/${uid}/projects/${projectId}/files/${fileIdForPath('index.html')}`).set({
      path: 'index.html',
      content: '<html><body></body></html>',
      sizeBytes: 26,
      contentHash: 'h1',
      version: 1,
      language: 'html',
      updatedAt: Timestamp.fromMillis(1000),
    });
    await db.doc(`users/${uid}/projects/${projectId}/files/${fileIdForPath('app.js')}`).set({
      path: 'app.js',
      content: 'var a=1;',
      sizeBytes: 8,
      contentHash: 'h2',
      version: 1,
      language: 'javascript',
      updatedAt: Timestamp.fromMillis(2000),
    });
    const messages = db.collection(`users/${uid}/projects/${projectId}/messages`);
    await messages.add({
      role: 'user',
      content: 'old',
      generationId: 'g1',
      meta: null,
      createdAt: Timestamp.fromMillis(1),
    });
    await messages.add({
      role: 'assistant',
      content: 'done',
      generationId: 'g1',
      meta: { status: 'completed' },
      createdAt: Timestamp.fromMillis(2),
    });
    await messages.add({
      role: 'user',
      content: 'now',
      generationId: 'g-current',
      meta: null,
      createdAt: Timestamp.fromMillis(3),
    });

    const builder = new ContextBuilder(db, { getContext: () => Promise.resolve(connected) });
    const built = await builder.build({
      uid,
      projectId,
      projectName: 'Demo',
      projectDescription: '',
      generationId: 'g-current',
      prompt: 'Add a footer',
    });
    expect(built.currentFiles.size).toBe(2);
    expect(built.messages.at(-1)?.content).toContain('index.html');
    expect(built.messages.at(-1)?.content).toContain('app.js');
    expect(built.messages.at(-1)?.content).toContain('Add a footer');
    expect(built.messages.some((m) => m.content === 'now')).toBe(false);
    expect(built.messages.some((m) => m.content === 'old')).toBe(true);
  });
});
