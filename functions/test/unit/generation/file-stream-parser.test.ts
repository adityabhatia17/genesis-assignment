import {
  coalesce,
  END_MARKER,
  FileStreamParser,
  type ParserEvent,
} from '../../../src/modules/generation/protocol/file-stream-parser.js';

function run(chunks: string[]): ParserEvent[] {
  const p = new FileStreamParser();
  const out: ParserEvent[] = [];
  for (const c of chunks) out.push(...p.push(c));
  out.push(...p.finish());
  return coalesce(out);
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ALPHABET = 'abc xyz\n\t{}();<>"\'⟦⟧/=\r';
function randText(rnd: () => number, n: number): string {
  let s = '';
  for (let i = 0; i < n; i += 1) s += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
  return s
    .replaceAll('⟦FILE', '⟦FIL_')
    .replaceAll('⟦DELETE', '⟦DEL_')
    .replaceAll(END_MARKER, '⟦/FIL_⟧')
    .replaceAll('\n⟦F', '\n⟦_')
    .replaceAll('\n⟦D', '\n⟦_');
}
function randomSplit(s: string, rnd: () => number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length;) {
    const n = 1 + Math.floor(rnd() * 12);
    out.push(s.slice(i, i + n));
    i += n;
  }
  return out;
}

describe('FileStreamParser', () => {
  it('is chunking-invariant and preserves content (3,000 random documents)', () => {
    const rnd = mulberry32(42);
    const paths = ['index.html', 'styles.css', 'app.js', 'lib/util.js'];
    for (let t = 0; t < 3000; t += 1) {
      const files: { path: string; content: string }[] = [];
      let doc = randText(rnd, 20).replaceAll('⟦', '[');
      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k += 1) {
        const content = randText(rnd, Math.floor(rnd() * 60))
          .replace(/^[\r\n]+/, 'x')
          .replace(/[\r\n]+$/, 'y');
        doc += `\n⟦FILE path="${paths[k]}"⟧\n${content}\n${END_MARKER}\n`;
        files.push({ path: paths[k]!, content });
      }
      const whole = run([doc]);
      expect(run(randomSplit(doc, rnd))).toEqual(whole);
      const ends = whole.filter(
        (e): e is Extract<ParserEvent, { type: 'file_end' }> => e.type === 'file_end',
      );
      expect(ends.map((e) => ({ path: e.path, content: e.content }))).toEqual(files);
      for (const f of ends) {
        const streamed = whole
          .filter((e) => e.type === 'file_chunk' && e.path === f.path)
          .map((e) => (e as { text: string }).text)
          .join('');
        expect(streamed).toBe(f.content);
      }
      for (const e of whole)
        if (e.type === 'prose')
          expect(e.text.includes('⟦FILE') || e.text.includes(END_MARKER)).toBe(false);
    }
  });

  it('keeps prose that precedes a marker in the same chunk', () => {
    expect(
      run([`Here is your app.\n⟦FILE path="app.js"⟧\nconsole.log(1)\n${END_MARKER}\nDone.`]),
    ).toEqual([
      { type: 'prose', text: 'Here is your app.\n' },
      { type: 'file_start', path: 'app.js' },
      { type: 'file_chunk', path: 'app.js', text: 'console.log(1)' },
      { type: 'file_end', path: 'app.js', content: 'console.log(1)' },
      { type: 'prose', text: 'Done.' },
    ]);
  });

  it('tolerates quotes variants and extra attributes', () => {
    expect(
      run([`⟦FILE path='index.html' lang="html"⟧\n<p>x</p>\n${END_MARKER}`]).find(
        (e) => e.type === 'file_end',
      ),
    ).toMatchObject({ content: '<p>x</p>' });
    expect(
      run([`⟦FILE path=app.js⟧\nx\n${END_MARKER}`]).find((e) => e.type === 'file_end'),
    ).toMatchObject({
      path: 'app.js',
    });
  });

  it('aborts an unterminated file at the end of the stream', () => {
    const last = run(['⟦FILE path="app.js"⟧\nlet a = 1;\nlet b']).at(-1);
    expect(last).toEqual({
      type: 'file_abort',
      path: 'app.js',
      content: 'let a = 1;\nlet b',
      reason: 'unterminated',
    });
  });

  it('aborts the previous file when a new marker starts before the end marker', () => {
    const ev = run([`⟦FILE path="a.js"⟧\nx\n⟦FILE path="b.js"⟧\ny\n${END_MARKER}`]);
    expect(ev.map((e) => e.type)).toEqual([
      'file_start',
      'file_chunk',
      'protocol_warning',
      'file_abort',
      'file_start',
      'file_chunk',
      'file_end',
    ]);
  });

  it('parses deletes, stray end markers and lone brackets', () => {
    expect(run(['Removing.\n⟦DELETE path="old.js"⟧\n'])).toEqual([
      { type: 'prose', text: 'Removing.\n' },
      { type: 'file_delete', path: 'old.js' },
    ]);
    expect(run([`${END_MARKER}`])[0]).toMatchObject({
      type: 'protocol_warning',
      code: 'STRAY_END_MARKER',
    });
    expect(run(['a ⟦ b ', '⟦x⟧ c'])).toEqual([{ type: 'prose', text: 'a ⟦ b ⟦x⟧ c' }]);
  });

  it('handles CRLF split across chunks and keeps intentional blank lines', () => {
    expect(
      run(['⟦FILE path="a.js"⟧\r', '\nx\r\n', END_MARKER]).find((e) => e.type === 'file_end'),
    ).toMatchObject({
      content: 'x',
    });
    expect(
      run([`⟦FILE path="a.js"⟧\nx\n\n\n${END_MARKER}`]).find((e) => e.type === 'file_end'),
    ).toMatchObject({
      content: 'x\n\n',
    });
  });

  it('flags malformed markers and treats them as prose', () => {
    const ev = run(['⟦FILE name="x"⟧ oops']);
    expect(ev[0]).toMatchObject({ type: 'protocol_warning', code: 'MALFORMED_MARKER' });
    expect(ev.at(-1)).toMatchObject({ type: 'prose' });
  });
});
