import { ANCHOR_ISO, XSS_NAME, type FixtureSet } from './fixtures.js';

export type ScenarioMode = 'data' | 'empty' | 'error' | 'loading' | 'adversarial';

export interface MockSpec {
  mode: ScenarioMode;
  fixture: FixtureSet;
  /** When set, list methods return this many contacts so paging can be tested. */
  contactCount?: number;
}

/** A script that looks like window.genesis to generated code and records every call. */
export function mockScript(spec: MockSpec): string {
  const payload = JSON.stringify({ ...spec, anchor: ANCHOR_ISO, xss: XSS_NAME });
  return `(function (window) {
  var RealDate = window.Date;
  var anchor = new RealDate(${JSON.stringify(ANCHOR_ISO)}).getTime();
  function FixedDate() {
    if (arguments.length === 0) return new RealDate(anchor);
    return new RealDate(...arguments);
  }
  FixedDate.now = function () { return anchor; };
  FixedDate.parse = RealDate.parse;
  FixedDate.UTC = RealDate.UTC;
  FixedDate.prototype = RealDate.prototype;
  window.Date = FixedDate;
  var spec = ${payload};
  var calls = [];
  function GenesisError(code, message, retryable) {
    var e = new Error(message);
    e.code = code;
    e.retryable = retryable;
    return e;
  }
  function contacts() {
    if (spec.contactCount) {
      var list = [];
      for (var i = 0; i < spec.contactCount; i++) list.push({ id: 'c_' + i, name: 'Person ' + (i + 1), email: 'p' + i + '@example.com' });
      return list;
    }
    if (spec.mode === 'adversarial') {
      return spec.fixture.contacts.map(function (c, i) { return i === 0 ? Object.assign({}, c, { name: spec.xss }) : c; });
    }
    return spec.fixture.contacts;
  }
  function page(items, params) {
    var limit = Math.min(20, Number(params && params.limit) || 20);
    var start = params && params.cursor ? Number(params.cursor) : 0;
    var slice = items.slice(start, start + limit);
    var more = start + limit < items.length;
    return { items: slice, nextCursor: more ? String(start + limit) : null, hasMore: more };
  }
  function filterQuery(items, params, field) {
    var q = params && typeof params.query === 'string' ? params.query.toLowerCase() : '';
    if (!q) return items;
    return items.filter(function (item) { return String(item[field] || '').toLowerCase().indexOf(q) >= 0; });
  }
  function answer(method, params) {
    calls.push({ method: method, params: params || {} });
    if (spec.mode === 'loading') return new Promise(function () {});
    if (spec.mode === 'error') return Promise.reject(GenesisError('HL_UNAVAILABLE', 'Could not load.', true));
    if (spec.mode === 'empty') {
      if (method === 'location.get') return Promise.resolve({ id: 'loc', name: spec.fixture.locationName });
      if (method === 'contacts.get') return Promise.resolve(null);
      if (method.indexOf('.list') >= 0 || method === 'conversations.messages') return Promise.resolve({ items: [], nextCursor: null, hasMore: false });
      return Promise.resolve({ items: [] });
    }
    if (method === 'location.get') return Promise.resolve({ id: 'loc', name: spec.fixture.locationName, timezone: 'UTC' });
    if (method === 'contacts.list') return Promise.resolve(page(filterQuery(contacts(), params, 'name'), params));
    if (method === 'contacts.get') {
      var found = contacts().filter(function (c) { return c.id === (params && params.contactId); })[0] || null;
      return Promise.resolve(found);
    }
    if (method === 'conversations.list') return Promise.resolve(page(spec.fixture.conversations, params));
    if (method === 'conversations.messages') return Promise.resolve({ items: [{ id: 'm1', body: 'Hello', direction: 'inbound' }], nextCursor: null, hasMore: false });
    if (method === 'calendars.list') return Promise.resolve({ items: [{ id: 'cal_1', name: 'Main' }] });
    if (method === 'calendars.events') return Promise.resolve({ items: spec.fixture.events });
    return Promise.reject(GenesisError('VALIDATION_FAILED', 'Unknown method', false));
  }
  var highlevel = {};
  ['location.get','contacts.list','contacts.get','conversations.list','conversations.messages','calendars.list','calendars.events'].forEach(function (name) {
    var parts = name.split('.');
    highlevel[parts[0]] = highlevel[parts[0]] || {};
    highlevel[parts[0]][parts[1]] = function (params) { return answer(name, params); };
  });
  window.genesis = Object.freeze({
    version: '1',
    ready: Promise.resolve(),
    context: { locationName: spec.fixture.locationName },
    highlevel: Object.freeze(highlevel),
    on: function () { return function () {}; },
    GenesisError: GenesisError
  });
  Object.defineProperty(window, '__genesisCalls', { value: calls });
})(window);`;
}
