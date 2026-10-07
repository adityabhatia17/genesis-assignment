import type { Issue } from '../../../contracts/firestore-docs.js';
import type { FileLanguage } from '../../../contracts/paths.js';
import type { FileOp } from '../validation/validate-file.js';

/** Everything the runner used to do with the SSE writer and the generations repo. */
export interface CandidateSink {
  onFirstToken?(): void;
  onThinking?(text: string): void | Promise<void>;
  onWritingStarted?(): void | Promise<void>;
  onProse?(text: string): void | Promise<void>;
  onFileStarted?(path: string, language: FileLanguage): void | Promise<void>;
  onFileDelta?(path: string, text: string): void | Promise<void>;
  stage(op: FileOp, warnings: Issue[]): Promise<void>;
  onFileCompleted?(ev: {
    path: string;
    status: 'valid' | 'rejected';
    sizeBytes: number;
    sha256: string;
    issues: Issue[];
  }): void | Promise<void>;
  onFileDeleted?(ev: {
    path: string;
    status: 'valid' | 'rejected';
    issues: Issue[];
  }): void | Promise<void>;
  afterChunk?(): Promise<void>;
  onProtocolWarning?(code: string): void;
}
