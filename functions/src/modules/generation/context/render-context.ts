import type { MessageMeta } from '../../../contracts/firestore-docs.js';
import { LIMITS } from '../../../contracts/limits.js';
import type { FileLanguage } from '../../../contracts/paths.js';
import type { HighLevelContext } from '../../highlevel/metadata/location-context.service.js';

export interface SystemBlock {
  text: string;
  cache: boolean;
}
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface HistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  generationId: string | null;
  meta: MessageMeta | null;
  createdAtMs: number;
}

export interface CurrentFile {
  fileId: string;
  path: string;
  content: string;
  sizeBytes: number;
  contentHash: string;
  version: number;
  language: FileLanguage;
  updatedAtMs: number;
}

const truncate = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max)}\n…[truncated]` : s;

export function buildHistory(
  messages: readonly HistoryMessage[],
  currentGenerationId: string,
): { turns: ChatTurn[]; notes: string[] } {
  const notes: string[] = [];
  const raw: ChatTurn[] = [];
  const recent = messages
    .filter((m) => m.generationId !== currentGenerationId || m.role === 'system')
    .slice(-LIMITS.historyMessages);
  for (const msg of recent) {
    if (msg.role === 'system') {
      notes.push(`${new Date(msg.createdAtMs).toISOString()}: ${truncate(msg.content, 300)}`);
      continue;
    }
    let content = truncate(msg.content, LIMITS.historyMessageMaxChars);
    if (msg.role === 'assistant') {
      if (msg.meta?.changedPaths?.length)
        content += `\n\n[Files changed: ${msg.meta.changedPaths.join(', ')}]`;
      if (msg.meta?.status && msg.meta.status !== 'completed')
        content += `\n\n[Generation ${msg.meta.status}]`;
    }
    raw.push({ role: msg.role, content });
  }
  while (raw[0]?.role === 'assistant') raw.shift();
  const turns: ChatTurn[] = [];
  for (const t of raw) {
    const last = turns.at(-1);
    if (last && last.role === t.role) last.content += `\n\n${t.content}`;
    else turns.push({ ...t });
  }
  if (turns.at(-1)?.role === 'user') turns.pop(); // the next turn is the current request (user)
  return { turns, notes };
}

export function selectFilesWithinBudget<
  F extends { path: string; sizeBytes: number; updatedAtMs: number },
>(
  files: readonly F[],
  budgetBytes: number,
): { included: F[]; omitted: { path: string; bytes: number }[] } {
  const ordered = [...files].sort((a, b) =>
    a.path === 'index.html' ? -1 : b.path === 'index.html' ? 1 : b.updatedAtMs - a.updatedAtMs,
  );
  const included: F[] = [];
  const omitted: { path: string; bytes: number }[] = [];
  let used = 0;
  for (const f of ordered) {
    if (used + f.sizeBytes <= budgetBytes || f.path === 'index.html') {
      included.push(f);
      used += f.sizeBytes;
    } else omitted.push({ path: f.path, bytes: f.sizeBytes });
  }
  included.sort((a, b) =>
    a.path === 'index.html' ? -1 : b.path === 'index.html' ? 1 : a.path.localeCompare(b.path),
  );
  return { included, omitted };
}

const esc = (s: string) => s.replace(/"/g, '&quot;');

export function renderUserTurn(i: {
  projectName: string;
  projectDescription: string;
  files: readonly { path: string; sizeBytes: number; content: string }[];
  omitted: readonly { path: string; bytes: number }[];
  hl: HighLevelContext;
  notes: readonly string[];
  prompt: string;
}): string {
  const parts: string[] = [];
  if (i.notes.length)
    parts.push(
      `<conversation_notes>\n${i.notes.map((n) => `- ${n}`).join('\n')}\n</conversation_notes>`,
    );

  const hl =
    i.hl.status !== 'connected'
      ? 'HighLevel is not connected yet. Still write the app against window.genesis.highlevel; calls will show a "connect HighLevel" error until the user connects.'
      : [
          `Location: ${i.hl.locationName ?? 'unknown'}${i.hl.timezone ? ` (timezone ${i.hl.timezone})` : ''}`,
          `Calendars (${i.hl.calendars.length}): ${i.hl.calendars.join('; ') || 'none'}`,
          `Contacts: ${i.hl.contactsTotal === null ? 'unknown' : `about ${i.hl.contactsTotal}`}`,
          `Available methods: ${i.hl.availableMethods.join(', ')}`,
          ...(i.hl.note ? [`Note: ${i.hl.note}`] : []),
        ].join('\n');
  parts.push(`<highlevel_context>\n${hl}\n</highlevel_context>`);

  const total = i.files.reduce((s, f) => s + f.sizeBytes, 0);
  const header = `<project_files project="${esc(i.projectName)}" description="${esc(i.projectDescription)}" count="${i.files.length}" total_bytes="${total}">`;
  if (i.files.length === 0) {
    parts.push(
      `${header}\nNo files yet — create index.html, styles.css and app.js (add more files only if they help).\n</project_files>`,
    );
  } else {
    const body = i.files
      .map((f) => `<file path="${esc(f.path)}" bytes="${f.sizeBytes}">\n${f.content}\n</file>`)
      .join('\n');
    const omitted = i.omitted.length
      ? `\n<omitted>${i.omitted.map((o) => `${o.path} (${o.bytes} bytes)`).join(', ')}</omitted>`
      : '';
    parts.push(`${header}\n${body}${omitted}\n</project_files>`);
  }
  parts.push(`<request>\n${i.prompt}\n</request>`);
  return parts.join('\n\n');
}
