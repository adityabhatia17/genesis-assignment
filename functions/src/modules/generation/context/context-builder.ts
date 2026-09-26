import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { MessageMeta } from '../../../contracts/firestore-docs.js';
import { LIMITS } from '../../../contracts/limits.js';
import { FileLanguageSchema } from '../../../contracts/paths.js';
import { paths } from '../../../shared/firestore-paths.js';
import type { LocationContextPort } from '../../highlevel/metadata/location-context.service.js';
import { SYSTEM_PROMPT_V1 } from '../prompt/system-prompt.v1.js';
import {
  buildHistory,
  renderUserTurn,
  selectFilesWithinBudget,
  type ChatTurn,
  type CurrentFile,
  type HistoryMessage,
  type SystemBlock,
} from './render-context.js';

export interface BuiltContext {
  system: SystemBlock[];
  messages: ChatTurn[];
  currentFiles: Map<string, CurrentFile>;
  stats: {
    fileCount: number;
    historyMessages: number;
    externalIncluded: boolean;
    promptChars: number;
  };
}

export interface BuildInput {
  uid: string;
  projectId: string;
  projectName: string;
  projectDescription: string;
  generationId: string;
  prompt: string;
}

const Ts = z.custom<Timestamp>((v) => v instanceof Timestamp, 'Expected Timestamp');

const FileSnapSchema = z.object({
  path: z.string(),
  content: z.string(),
  sizeBytes: z.number(),
  contentHash: z.string(),
  version: z.number(),
  language: FileLanguageSchema,
  updatedAt: Ts,
});

const MessageSnapSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  generationId: z.string().nullable().optional(),
  meta: z.unknown().nullable().optional(),
  createdAt: Ts,
});

export class ContextBuilder {
  constructor(
    private readonly db: Firestore,
    private readonly locationContext: LocationContextPort,
  ) {}

  async build(i: BuildInput): Promise<BuiltContext> {
    const [filesSnap, messagesSnap, hl] = await Promise.all([
      this.db.collection(paths.files(i.uid, i.projectId)).get(),
      this.db
        .collection(paths.messages(i.uid, i.projectId))
        .orderBy('createdAt', 'desc')
        .limit(30)
        .get(),
      this.locationContext.getContext(i.uid),
    ]);

    const currentFiles = new Map<string, CurrentFile>();
    for (const d of filesSnap.docs) {
      const f = FileSnapSchema.parse(d.data());
      currentFiles.set(f.path, {
        fileId: d.id,
        path: f.path,
        content: f.content,
        sizeBytes: f.sizeBytes,
        contentHash: f.contentHash,
        version: f.version,
        language: f.language,
        updatedAtMs: f.updatedAt.toMillis(),
      });
    }

    const history: HistoryMessage[] = messagesSnap.docs.reverse().map((d) => {
      const m = MessageSnapSchema.parse(d.data());
      return {
        role: m.role,
        content: m.content,
        generationId: m.generationId ?? null,
        meta: (m.meta as MessageMeta | null) ?? null,
        createdAtMs: m.createdAt.toMillis(),
      };
    });
    const { turns, notes } = buildHistory(history, i.generationId);
    const { included, omitted } = selectFilesWithinBudget(
      [...currentFiles.values()],
      LIMITS.maxProjectBytes,
    );

    const text = renderUserTurn({
      projectName: i.projectName,
      projectDescription: i.projectDescription,
      files: included,
      omitted,
      hl,
      notes,
      prompt: i.prompt,
    });
    return {
      system: [{ text: SYSTEM_PROMPT_V1, cache: true }],
      messages: [...turns, { role: 'user', content: text }],
      currentFiles,
      stats: {
        fileCount: included.length,
        historyMessages: turns.length,
        externalIncluded: hl.status === 'connected' && hl.note === null,
        promptChars: i.prompt.length,
      },
    };
  }
}
