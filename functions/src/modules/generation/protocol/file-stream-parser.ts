export const MARK_OPEN = '⟦';
export const END_MARKER = '⟦/FILE⟧';

const FILE_OPEN_RE =
  /^⟦FILE\s+path\s*=\s*(?:"([^"\r\n]{1,200})"|'([^'\r\n]{1,200})'|([^\s"'⟧\r\n]{1,200}))[^⟧\r\n]*⟧/;
const DELETE_RE =
  /^⟦DELETE\s+path\s*=\s*(?:"([^"\r\n]{1,200})"|'([^'\r\n]{1,200})'|([^\s"'⟧\r\n]{1,200}))[^⟧\r\n]*⟧/;
const MARKER_PREFIXES = ['⟦FILE', '⟦DELETE', END_MARKER];
const LINE_START_MARKERS = ['\n⟦FILE', '\n⟦DELETE'];
const HOLD_BACK = Math.max(END_MARKER.length, ...LINE_START_MARKERS.map((m) => m.length)) - 1;
const MAX_MARKER_LEN = 256;

export type ParserEvent =
  | { type: 'prose'; text: string }
  | { type: 'file_start'; path: string }
  | { type: 'file_chunk'; path: string; text: string }
  | { type: 'file_end'; path: string; content: string }
  | { type: 'file_delete'; path: string }
  | {
      type: 'file_abort';
      path: string;
      content: string;
      reason: 'unterminated' | 'next_marker_before_end';
    }
  | {
      type: 'protocol_warning';
      code: 'MALFORMED_MARKER' | 'STRAY_END_MARKER' | 'UNTERMINATED_FILE';
      detail?: string;
      path?: string;
    };

const pathOf = (m: RegExpExecArray): string => (m[1] ?? m[2] ?? m[3] ?? '').trim();

/**
 * Incremental parser for the ⟦FILE⟧ protocol. Invariants (property-tested):
 * chunking invariance; concat(file_chunk) === file_end.content; no marker fragments in prose/chunks.
 */
export class FileStreamParser {
  private mode: 'prose' | 'file' = 'prose';
  private pending = '';
  private path = '';
  private content = '';
  private skipNewline = false;
  private events: ParserEvent[] = [];

  push(text: string): ParserEvent[] {
    this.pending += text;
    this.drain(false);
    return this.take();
  }

  finish(): ParserEvent[] {
    this.drain(true);
    if (this.mode === 'file') {
      this.events.push({
        type: 'file_abort',
        path: this.path,
        content: this.content + this.pending,
        reason: 'unterminated',
      });
      this.pending = '';
      this.mode = 'prose';
    } else if (this.pending) {
      this.emitProse(this.pending);
      this.pending = '';
    }
    return this.take();
  }

  private take(): ParserEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private emitProse(text: string): void {
    if (text) this.events.push({ type: 'prose', text });
  }

  private emitChunk(text: string): void {
    if (!text) return;
    this.content += text;
    this.events.push({ type: 'file_chunk', path: this.path, text });
  }

  /** The newline right after a marker belongs to the marker line. Returns false if more input is needed. */
  private consumeLeadingNewline(final: boolean): boolean {
    if (!this.skipNewline) return true;
    const p = this.pending;
    if (p === '') return final;
    if (p === '\r' && !final) return false;
    if (p.startsWith('\r\n')) this.pending = p.slice(2);
    else if (p.startsWith('\n')) this.pending = p.slice(1);
    this.skipNewline = false;
    return true;
  }

  private drain(final: boolean): void {
    for (;;) {
      if (!this.consumeLeadingNewline(final)) return;
      const progressed = this.mode === 'prose' ? this.drainProse(final) : this.drainFile(final);
      if (!progressed) return;
    }
  }

  private drainProse(final: boolean): boolean {
    const p = this.pending;
    if (p === '') return false;
    const i = p.indexOf(MARK_OPEN);
    if (i === -1) {
      this.emitProse(p);
      this.pending = '';
      return false;
    }
    if (i > 0) {
      this.emitProse(p.slice(0, i));
      this.pending = p.slice(i);
      return true;
    }

    const open = FILE_OPEN_RE.exec(p);
    if (open) {
      this.mode = 'file';
      this.path = pathOf(open);
      this.content = '';
      this.events.push({ type: 'file_start', path: this.path });
      this.pending = p.slice(open[0].length);
      this.skipNewline = true;
      return true;
    }
    const del = DELETE_RE.exec(p);
    if (del) {
      this.events.push({ type: 'file_delete', path: pathOf(del) });
      this.pending = p.slice(del[0].length);
      this.skipNewline = true;
      return true;
    }
    if (p.startsWith(END_MARKER)) {
      this.events.push({ type: 'protocol_warning', code: 'STRAY_END_MARKER' });
      this.pending = p.slice(END_MARKER.length);
      this.skipNewline = true;
      return true;
    }
    if (!final && this.couldBecomeMarker(p)) return false;
    if (/^⟦(?:FILE|DELETE)/.test(p))
      this.events.push({
        type: 'protocol_warning',
        code: 'MALFORMED_MARKER',
        detail: p.slice(0, 80),
      });
    this.emitProse(MARK_OPEN);
    this.pending = p.slice(1);
    return true;
  }

  private couldBecomeMarker(rest: string): boolean {
    if (MARKER_PREFIXES.some((m) => m.startsWith(rest))) return true;
    return (
      /^⟦(?:FILE|DELETE)/.test(rest) &&
      !rest.includes('⟧') &&
      !/[\r\n]/.test(rest) &&
      rest.length < MAX_MARKER_LEN
    );
  }

  private drainFile(final: boolean): boolean {
    const p = this.pending;
    if (p === '') return false;
    const endIdx = p.indexOf(END_MARKER);
    let nestIdx = -1;
    for (const m of LINE_START_MARKERS) {
      const k = p.indexOf(m);
      if (k !== -1 && (nestIdx === -1 || k < nestIdx)) nestIdx = k;
    }

    if (endIdx !== -1 && (nestIdx === -1 || endIdx < nestIdx)) {
      let piece = p.slice(0, endIdx);
      if (piece.endsWith('\r\n')) piece = piece.slice(0, -2);
      else if (piece.endsWith('\n')) piece = piece.slice(0, -1);
      this.emitChunk(piece);
      this.events.push({ type: 'file_end', path: this.path, content: this.content });
      this.mode = 'prose';
      this.pending = p.slice(endIdx + END_MARKER.length);
      this.skipNewline = true;
      return true;
    }
    if (nestIdx !== -1) {
      this.emitChunk(p.slice(0, nestIdx));
      this.events.push({ type: 'protocol_warning', code: 'UNTERMINATED_FILE', path: this.path });
      this.events.push({
        type: 'file_abort',
        path: this.path,
        content: this.content,
        reason: 'next_marker_before_end',
      });
      this.mode = 'prose';
      this.pending = p.slice(nestIdx + 1);
      return true;
    }
    if (final) return false;

    // Hold back a possible partial end marker and trailing newlines (they may belong to the end marker line).
    let holdFrom = Math.max(0, p.length - HOLD_BACK);
    while (holdFrom > 0 && (p[holdFrom - 1] === '\n' || p[holdFrom - 1] === '\r')) holdFrom -= 1;
    if (holdFrom === 0) return false;
    this.emitChunk(p.slice(0, holdFrom));
    this.pending = p.slice(holdFrom);
    return false;
  }
}

/** Merges adjacent prose events and adjacent chunks of the same file (for tests and logging). */
export function coalesce(events: readonly ParserEvent[]): ParserEvent[] {
  const out: ParserEvent[] = [];
  for (const e of events) {
    const last = out.at(-1);
    if (last?.type === 'prose' && e.type === 'prose') {
      out[out.length - 1] = { type: 'prose', text: last.text + e.text };
      continue;
    }
    if (last?.type === 'file_chunk' && e.type === 'file_chunk' && last.path === e.path) {
      out[out.length - 1] = { type: 'file_chunk', path: e.path, text: last.text + e.text };
      continue;
    }
    out.push({ ...e });
  }
  return out;
}
