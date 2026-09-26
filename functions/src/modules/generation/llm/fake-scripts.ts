import { END_MARKER } from '../protocol/file-stream-parser.js';

export const DEMO_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Contacts &amp; Appointments</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main class="app">
    <header class="app__header">
      <h1>Contacts &amp; upcoming appointments</h1>
      <p class="muted" id="location"></p>
    </header>
    <section class="panel" aria-labelledby="contacts-title">
      <div class="panel__head">
        <h2 id="contacts-title">Contacts</h2>
        <label class="search"><span class="sr-only">Search contacts</span><input id="search" type="search" placeholder="Search contacts"></label>
      </div>
      <ul id="contacts" class="list"></ul>
      <p id="contacts-status" class="status" role="status"></p>
    </section>
    <section class="panel" aria-labelledby="appointments-title">
      <h2 id="appointments-title">Next 14 days</h2>
      <ul id="appointments" class="list"></ul>
      <p id="appointments-status" class="status" role="status"></p>
    </section>
  </main>
  <script src="app.js"></script>
</body>
</html>`;

export const DEMO_STYLES_CSS = `:root { --bg: #f8fafc; --panel: #ffffff; --text: #0f172a; --muted: #64748b; --accent: #4f46e5; --border: #e2e8f0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
.app { max-width: 960px; margin: 0 auto; padding: 24px; display: grid; gap: 16px; }
.app__header h1 { margin: 0 0 4px; font-size: 1.4rem; }
.muted { color: var(--muted); font-size: 0.9rem; }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
.panel__head { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; }
.panel h2 { margin: 0; font-size: 1.05rem; }
.search input { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; min-width: 220px; }
.search input:focus-visible, .button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; }
.item { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; }
.status { color: var(--muted); min-height: 1.2em; }
.button { margin-top: 8px; padding: 8px 14px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; cursor: pointer; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }`;

export const DEMO_APP_JS = `(function () {
  'use strict';
  var state = { cursor: null, query: '', loading: false };
  function el(id) { return document.getElementById(id); }

  function formatDate(iso, timeZone) {
    if (!iso) return '—';
    try {
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: timeZone || undefined }).format(new Date(iso));
    } catch (e) {
      return iso;
    }
  }

  function item(title, meta) {
    var li = document.createElement('li');
    li.className = 'item';
    var strong = document.createElement('strong');
    strong.textContent = title;
    var span = document.createElement('span');
    span.className = 'muted';
    span.textContent = meta;
    li.append(strong, span);
    return li;
  }

  async function loadContacts(reset) {
    if (state.loading) return;
    state.loading = true;
    var list = el('contacts');
    var status = el('contacts-status');
    if (reset) { list.replaceChildren(); state.cursor = null; }
    status.textContent = 'Loading contacts…';
    try {
      var page = await window.genesis.highlevel.contacts.list({ query: state.query || undefined, limit: 20, cursor: state.cursor || undefined });
      page.items.forEach(function (c) { list.append(item(c.name, (c.email || '—') + ' · ' + (c.phone || '—'))); });
      state.cursor = page.nextCursor;
      el('more').hidden = !page.hasMore;
      status.textContent = list.children.length === 0 ? 'No contacts found.' : '';
    } catch (err) {
      status.textContent = err.message + (err.retryable ? ' — try again.' : '');
    } finally {
      state.loading = false;
    }
  }

  async function loadAppointments(timeZone) {
    var list = el('appointments');
    var status = el('appointments-status');
    status.textContent = 'Loading appointments…';
    var from = new Date();
    var to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);
    try {
      var result = await window.genesis.highlevel.calendars.events({ from: from.toISOString(), to: to.toISOString() });
      list.replaceChildren();
      result.items.forEach(function (a) { list.append(item(a.title || 'Appointment', formatDate(a.startTime, timeZone) + (a.status ? ' · ' + a.status : ''))); });
      status.textContent = result.items.length === 0 ? 'No upcoming appointments.' : '';
    } catch (err) {
      status.textContent = err.message;
    }
  }

  function debounce(fn, ms) {
    var t;
    return function (value) { clearTimeout(t); t = setTimeout(function () { fn(value); }, ms); };
  }

  function start() {
    var ctx = window.genesis.context;
    var tz = ctx.location ? ctx.location.timezone : null;
    el('location').textContent = ctx.location ? ctx.location.name : 'HighLevel not connected';
    var search = debounce(function (value) { state.query = value; loadContacts(true); }, 300);
    el('search').addEventListener('input', function (e) { search(e.target.value.trim()); });
    el('more').addEventListener('click', function () { loadContacts(false); });
    loadContacts(true);
    loadAppointments(tz);
  }

  window.genesis.ready.then(start);
})();`;

const file = (path: string, content: string) =>
  `⟦FILE path="${path}"⟧\n${content}\n${END_MARKER}\n`;
const DEMO =
  file('index.html', DEMO_INDEX_HTML) +
  file('styles.css', DEMO_STYLES_CSS) +
  file('app.js', DEMO_APP_JS);

export interface FakeScript {
  text: string;
  thinking?: string;
  stopReason?: string;
  failAfterChars?: number;
  chunkDelayMs?: number;
}

export const FAKE_SCRIPTS: Record<string, FakeScript> = {
  default: {
    thinking:
      'Plan: a contacts list with search and pagination, plus upcoming appointments across calendars.',
    text: `I'm building a contacts dashboard with search and a list of appointments for the next 14 days.\n${DEMO}`,
  },
  'extra-invalid': { text: `Dashboard plus notes.\n${DEMO}${file('NOTES.md', 'not allowed')}` },
  badjs: {
    text: `Dashboard.\n${file('index.html', DEMO_INDEX_HTML)}${file('styles.css', DEMO_STYLES_CSS)}${file('app.js', 'function (')}`,
  },
  truncate: {
    stopReason: 'max_tokens',
    text: `Dashboard.\n${file('index.html', DEMO_INDEX_HTML)}⟦FILE path="app.js"⟧\n(function () {\n  var a = `,
  },
  error: {
    failAfterChars: DEMO.indexOf('⟦FILE path="styles.css"') + 20,
    text: `Dashboard.\n${DEMO}`,
  },
  slow: { chunkDelayMs: 150, text: `Dashboard.\n${DEMO}` },
  question: {
    text: 'This app lists your contacts with search and shows appointments for the next 14 days.',
  },
  refuse: { stopReason: 'refusal', text: "I can't help with that request." },
  refine: {
    text: `Renamed the page title.\n${file('index.html', DEMO_INDEX_HTML.replace('Contacts &amp; upcoming appointments</h1>', 'Acme CRM</h1>'))}`,
  },
  'with-old': {
    text: `Dashboard plus a helper.\n${DEMO}${file('old.js', 'var unusedHelper = true;')}`,
  },
  delete: {
    text: `Removed the unused helper.\n⟦DELETE path="old.js"⟧\n⟦DELETE path="index.html"⟧\n`,
  },
};

/** Picks a script by a `#name` tag inside the latest user request (default otherwise). */
export function selectScript(lastUserText: string): FakeScript {
  const request = /<request>\n([\s\S]*?)\n<\/request>/.exec(lastUserText)?.[1] ?? lastUserText;
  const tag = /#([a-z-]+)/.exec(request)?.[1];
  return (tag && FAKE_SCRIPTS[tag]) || (FAKE_SCRIPTS['default'] as FakeScript);
}
