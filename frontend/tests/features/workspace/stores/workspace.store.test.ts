import { createPinia, setActivePinia } from 'pinia';
import { useWorkspaceStore } from '@/features/workspace/stores/workspace.store';

describe('workspace store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('opens, activates and closes tabs predictably', () => {
    const ws = useWorkspaceStore();
    ws.reset('p1');
    ws.openFile('index.html');
    ws.openFile('app.js');
    ws.openFile('styles.css', false);
    expect(ws.openPaths).toEqual(['index.html', 'app.js', 'styles.css']);
    expect(ws.activePath).toBe('app.js');
    ws.closeFile('app.js');
    expect(ws.activePath).toBe('styles.css');
  });

  it('drops tabs and flags for deleted files', () => {
    const ws = useWorkspaceStore();
    ws.reset('p1');
    ws.openFile('old.js');
    ws.setDirty('old.js', true);
    ws.retainPaths(['index.html']);
    expect(ws.openPaths).toEqual([]);
    expect(ws.dirtyPaths).toEqual([]);
  });
});
