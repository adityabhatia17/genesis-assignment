/*
 * Genesis preview runtime v1 — injected before the app's own scripts in every preview document.
 * It runs in a sandboxed, opaque-origin iframe and holds no credentials: each HighLevel call is an
 * RPC over a MessageChannel to the Genesis host, which validates, rate-limits and authenticates it.
 * Plain ES2020, no imports (it is inlined into the document as text).
 */
(function (window) {
  'use strict';

  var NONCE = window.__GENESIS_NONCE__;
  try {
    delete window.__GENESIS_NONCE__;
  } catch (e) {
    /* ignore */
  }
  var TIMEOUT_MS = 22000; // host enforces 20 s; this is only a backstop
  var METHODS = [
    'location.get',
    'contacts.list',
    'contacts.get',
    'conversations.list',
    'conversations.messages',
    'calendars.list',
    'calendars.events',
  ];
  var EVENTS = [
    'contact.created',
    'contact.updated',
    'contact.deleted',
    'appointment.created',
    'appointment.updated',
    'appointment.deleted',
    'message.inbound',
    'message.outbound',
  ];

  // ── storage shims: sandboxed documents throw on localStorage/sessionStorage access ──
  function memoryStorage() {
    var data = new Map();
    return {
      get length() {
        return data.size;
      },
      key: function (i) {
        var keys = Array.from(data.keys());
        return i >= 0 && i < keys.length ? keys[i] : null;
      },
      getItem: function (k) {
        k = String(k);
        return data.has(k) ? data.get(k) : null;
      },
      setItem: function (k, v) {
        data.set(String(k), String(v));
      },
      removeItem: function (k) {
        data.delete(String(k));
      },
      clear: function () {
        data.clear();
      },
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    try {
      Object.defineProperty(window, name, { value: memoryStorage(), configurable: true });
    } catch (e) {
      /* keep the platform object */
    }
  });

  // ── outbound queue until the host hands us a port ──
  var port = null;
  var outbox = [];
  function send(message) {
    if (port) port.postMessage(message);
    else if (outbox.length < 200) outbox.push(message);
  }
  function text(value, max) {
    var out;
    try {
      if (typeof value === 'string') out = value;
      else if (value instanceof Error) out = value.name + ': ' + value.message;
      else out = JSON.stringify(value);
    } catch (e) {
      out = String(value);
    }
    if (out === undefined) out = String(value);
    return out.length > max ? out.slice(0, max) + '…' : out;
  }

  // ── console + error mirroring to the host console panel ──
  var consoleRef = window.console;
  ['log', 'info', 'warn', 'error'].forEach(function (level) {
    var original = consoleRef[level] ? consoleRef[level].bind(consoleRef) : function () {};
    consoleRef[level] = function () {
      var args = Array.prototype.slice.call(arguments);
      original.apply(null, args);
      send({
        type: 'console',
        level: level,
        args: args.slice(0, 20).map(function (a) {
          return text(a, 2000);
        }),
      });
    };
  });
  window.addEventListener('error', function (event) {
    send({
      type: 'runtime-error',
      message: text(event.message || 'Script error', 2000),
      stack: event.error && event.error.stack ? text(String(event.error.stack), 8000) : undefined,
    });
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    send({
      type: 'runtime-error',
      message: text(
        'Unhandled promise rejection: ' +
          (reason && reason.message ? reason.message : text(reason, 1000)),
        2000,
      ),
      stack: reason && reason.stack ? text(String(reason.stack), 8000) : undefined,
    });
  });

  // ── errors surfaced to generated code ──
  function GenesisError(code, message, retryable) {
    var error = new Error(message);
    Object.setPrototypeOf(error, GenesisError.prototype);
    error.name = 'GenesisError';
    error.code = code;
    error.retryable = Boolean(retryable);
    return error;
  }
  GenesisError.prototype = Object.create(Error.prototype);
  GenesisError.prototype.constructor = GenesisError;

  // ── handshake ──
  var resolveReady;
  var ready = new Promise(function (resolve) {
    resolveReady = resolve;
  });
  var context = null;
  var pending = new Map();
  var sequence = 0;
  var handlers = new Map();

  function onPortMessage(event) {
    var message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'rpc-result') {
      var call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.ok) call.resolve(message.result);
      else
        call.reject(
          GenesisError(message.error.code, message.error.message, message.error.retryable),
        );
    } else if (message.type === 'event') {
      (handlers.get(message.name) || []).forEach(function (handler) {
        try {
          handler(message.payload);
        } catch (e) {
          consoleRef.error(e);
        }
      });
    }
  }

  function onWindowMessage(event) {
    if (event.source !== window.parent || port) return;
    var message = event.data;
    if (
      !message ||
      message.source !== 'genesis-host' ||
      message.type !== 'init' ||
      message.nonce !== NONCE
    )
      return;
    var channel = event.ports && event.ports[0];
    if (!channel) return;
    port = channel;
    port.onmessage = onPortMessage;
    var ctx = message.context || {};
    context = Object.freeze({ location: ctx.location || null, project: ctx.project || null });
    window.removeEventListener('message', onWindowMessage);
    outbox.splice(0).forEach(function (queued) {
      port.postMessage(queued);
    });
    resolveReady();
  }
  window.addEventListener('message', onWindowMessage);
  window.parent.postMessage(
    { source: 'genesis-preview', type: 'hello', protocol: 1, nonce: NONCE },
    '*',
  );

  // ── RPC ──
  function rpc(method, params) {
    return ready.then(function () {
      return new Promise(function (resolve, reject) {
        sequence += 1;
        var id = 'r' + sequence;
        var timer = setTimeout(function () {
          pending.delete(id);
          reject(GenesisError('PREVIEW_TIMEOUT', 'HighLevel call timed out.', true));
        }, TIMEOUT_MS);
        pending.set(id, { resolve: resolve, reject: reject, timer: timer });
        try {
          port.postMessage({
            type: 'rpc',
            id: id,
            method: method,
            params: params === undefined ? {} : params,
          });
        } catch (e) {
          pending.delete(id);
          clearTimeout(timer);
          reject(
            GenesisError(
              'VALIDATION_FAILED',
              'Parameters must be plain data (no functions or DOM nodes).',
              false,
            ),
          );
        }
      });
    });
  }

  var highlevel = {};
  METHODS.forEach(function (name) {
    var parts = name.split('.');
    highlevel[parts[0]] = highlevel[parts[0]] || {};
    highlevel[parts[0]][parts[1]] = function (params) {
      return rpc(name, params);
    };
  });
  Object.keys(highlevel).forEach(function (area) {
    Object.freeze(highlevel[area]);
  });
  Object.freeze(highlevel);

  function on(name, handler) {
    if (EVENTS.indexOf(name) === -1 || typeof handler !== 'function') {
      throw new TypeError('genesis.on: unknown event "' + name + '"');
    }
    if (!handlers.has(name)) handlers.set(name, new Set());
    handlers.get(name).add(handler);
    return function () {
      handlers.get(name).delete(handler);
    };
  }

  var api = Object.freeze({
    version: '1',
    ready: ready,
    get context() {
      return context;
    },
    highlevel: highlevel,
    on: on,
    GenesisError: GenesisError,
  });
  Object.defineProperty(window, 'genesis', {
    value: api,
    writable: false,
    configurable: false,
    enumerable: true,
  });
})(window);
