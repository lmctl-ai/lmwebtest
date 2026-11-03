/**
 * Playwright side of the lmcode host. Runs in a worker thread so that the
 * synchronous lmcode VM on the main thread can block (Atomics.wait) while the
 * async Playwright calls complete here.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { workerData, MessageChannel } = require('worker_threads');
const { table, CLASS_TO_TYPE } = require('./methods.cjs');

const { sab, port } = workerData;
const flag = new Int32Array(sab);

const ids = new WeakMap();   // object -> id
const objects = new Map();   // id -> object
const logsOf = new WeakMap();
let nextId = 1;
let pw;                      // playwright-core, loaded lazily
const live = new Set();      // browsers / contexts / api contexts to close at shutdown

const ANSI = /\u001b\[[0-9;]*m/g;

function lazyPlaywright() {
  if (!pw)
    pw = require('playwright-core');
  return pw;
}

function register(obj) {
  let id = ids.get(obj);
  if (id === undefined) {
    id = nextId++;
    ids.set(obj, id);
    objects.set(id, obj);
  }
  return id;
}

function classTypeOf(v) {
  const name = v && v.constructor && v.constructor.name;
  if (name && CLASS_TO_TYPE[name])
    return CLASS_TO_TYPE[name];
  // Tracing / Keyboard / ... may be minified; fall back to "is it a Playwright object".
  if (v && typeof v === 'object' && v._type && CLASS_TO_TYPE[v._type])
    return CLASS_TO_TYPE[v._type];
  return undefined;
}

/** Playwright value -> JSON-able value (handles become {"$handle":id,"type":T}). */
function serialize(v, depth = 0) {
  if (v === undefined || v === null)
    return null;
  if (typeof v === 'bigint')
    return Number(v);
  if (typeof v !== 'object')
    return typeof v === 'function' ? undefined : v;
  if (Buffer.isBuffer(v) || v instanceof Uint8Array)
    return { $buffer: Buffer.from(v).toString('base64') };
  if (v instanceof RegExp)
    return { $regex: v.source, flags: v.flags };
  if (v instanceof Error)
    return { $error: v.message };
  const type = classTypeOf(v);
  if (type)
    return { $handle: register(v), type };
  if (depth > 20)
    return null;
  if (Array.isArray(v))
    return v.map(x => serialize(x, depth + 1));
  if (v instanceof Map)
    return Object.fromEntries([...v].map(([k, x]) => [String(k), serialize(x, depth + 1)]));
  const out = {};
  for (const k of Object.keys(v)) {
    const s = serialize(v[k], depth + 1);
    if (s !== undefined)
      out[k] = s;
  }
  return out;
}

/** JSON-parsed args -> Playwright values ($handle, $regex, $buffer, $file). */
function revive(v) {
  if (Array.isArray(v))
    return v.map(revive);
  if (v && typeof v === 'object') {
    if ('$handle' in v) {
      const o = objects.get(v.$handle);
      if (!o)
        throw new Error(`Unknown handle ${v.$handle}`);
      return o;
    }
    if ('$regex' in v)
      return new RegExp(v.$regex, v.flags || '');
    if ('$buffer' in v)
      return Buffer.from(v.$buffer, 'base64');
    if ('$file' in v)
      return fs.createReadStream(v.$file);
    const out = {};
    for (const k of Object.keys(v))
      out[k] = revive(v[k]);
    return out;
  }
  return v;
}

function json(s) {
  if (s === undefined || s === null || s === '')
    return undefined;
  try {
    return revive(JSON.parse(s));
  } catch (e) {
    throw new Error(`Invalid JSON argument: ${e.message}`);
  }
}

function urlMatcher(s) {
  const m = /^re:\/(.*)\/([a-z]*)$/s.exec(s);
  return m ? new RegExp(m[1], m[2]) : s;
}

function textOrRegex(v) {
  return typeof v === 'string' ? urlMatcher(v) : v;
}

function files(s) {
  const t = String(s).trim();
  let v = t;
  if (t.startsWith('[') || t.startsWith('{') || t.startsWith('"'))
    v = JSON.parse(t);
  const one = f => {
    if (typeof f === 'string')
      return f;
    if (f && typeof f === 'object' && ('text' in f || 'base64' in f || '$buffer' in f)) {
      const buffer = 'text' in f ? Buffer.from(f.text, 'utf8') : Buffer.from(f.base64 ?? f.$buffer, 'base64');
      return { name: f.name || 'file', mimeType: f.mimeType || 'application/octet-stream', buffer };
    }
    throw new Error('A file is a path or {"name","mimeType","text"|"base64"}');
  };
  const list = (Array.isArray(v) ? v : [v]).map(one);
  // Playwright refuses a mix of paths and buffers: read the paths so both can be uploaded.
  if (list.some(f => typeof f === 'string') && list.some(f => typeof f !== 'string')) {
    for (let i = 0; i < list.length; i++) {
      if (typeof list[i] === 'string') {
        const file = list[i];
        list[i] = { name: path.basename(file), mimeType: MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', buffer: fs.readFileSync(file) };
      }
    }
  }
  return Array.isArray(v) ? list : list[0];
}

const MIME = {
  '.txt': 'text/plain', '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.csv': 'text/csv', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.zip': 'application/zip', '.xml': 'application/xml',
};

function selectValues(s) {
  const t = String(s).trim();
  if (t.startsWith('[') || t.startsWith('{'))
    return JSON.parse(t);
  return t;
}

function browserType(name) {
  const bt = lazyPlaywright()[name];
  if (!bt || typeof bt.launch !== 'function')
    throw new Error(`Unknown browser "${name}" (use chromium, firefox or webkit)`);
  return bt;
}

function withDevice(opts) {
  if (opts && opts.device) {
    const { device, ...rest } = opts;
    const d = lazyPlaywright().devices[device];
    if (!d)
      throw new Error(`Unknown device "${device}"`);
    return { ...d, ...rest };
  }
  return opts;
}

function pageOf(o) {
  if (typeof o.page === 'function')
    return o.page();
  return o;
}

function logs(page) {
  let l = logsOf.get(page);
  if (!l)
    throw new Error('Page is not tracked');
  return l;
}

function track(page) {
  if (logsOf.has(page))
    return;
  const l = { console: [], errors: [], failed: [], httpErrors: [], dialogs: [], policy: { action: 'dismiss' } };
  logsOf.set(page, l);
  page.on('console', m => l.console.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => l.errors.push(String(e && e.message || e)));
  page.on('requestfailed', r => l.failed.push({ url: r.url(), error: r.failure()?.errorText ?? '' }));
  page.on('response', r => {
    if (r.status() >= 400)
      l.httpErrors.push({ url: r.url(), status: r.status() });
  });
  // Any dialog listener disables Playwright's auto-dismiss, so this one must settle every dialog.
  page.on('dialog', d => {
    l.dialogs.push({ type: d.type(), message: d.message(), defaultValue: d.defaultValue() });
    const p = l.policy;
    (p.action === 'accept' ? d.accept(p.text) : d.dismiss()).catch(() => {});
  });
}

function trackContext(ctx) {
  ctx.on('page', track);
  for (const p of ctx.pages())
    track(p);
  live.add(ctx);
  return ctx;
}

async function expectMatcher(o, matcher, argsJson, negate) {
  if (!/^to[A-Z]\w*$/.test(matcher))
    throw new Error(`"${matcher}" is not an expect matcher (e.g. toBeVisible, toHaveText)`);
  const { expect } = require('playwright/test');
  let args = argsJson ? json(argsJson) : [];
  if (!Array.isArray(args))
    args = [args];
  args = args.map(a => typeof a === 'string' ? textOrRegex(a) : a);
  const target = negate ? expect(o).not : expect(o);
  if (typeof target[matcher] !== 'function')
    throw new Error(`Unknown matcher ${matcher}`);
  await target[matcher](...args);
}

async function reflectRaw(o, methodPath, argsJson) {
  const parts = String(methodPath).split('.');
  let parent = o;
  for (const p of parts.slice(0, -1)) {
    parent = parent[p];
    if (parent === undefined || parent === null)
      throw new Error(`"${methodPath}": ${p} is not available`);
  }
  const last = parts[parts.length - 1];
  const member = parent[last];
  if (typeof member !== 'function') {
    if (member === undefined)
      throw new Error(`"${methodPath}" is not a member of ${classTypeOf(o) || 'object'}`);
    return member;
  }
  let args = argsJson ? json(argsJson) : [];
  if (!Array.isArray(args))
    throw new Error('call arguments must be a JSON array');
  return await member.apply(parent, args);
}

async function launch(name, opts) {
  const b = await browserType(name).launch({ headless: !process.env.LMCODE_HEADED, ...opts });
  live.add(b);
  return b;
}

const helpers = {
  get pw() { return lazyPlaywright(); },
  json, files, selectValues, urlMatcher, pageOf, logs, track, browserType, expectMatcher, reflectRaw,
  idOf: o => register(o),
  release: o => { const id = ids.get(o); if (id !== undefined) { objects.delete(id); ids.delete(o); } },
  reflect: async (o, p, a) => JSON.stringify(serialize(await reflectRaw(o, p, a))),
  launch,
  launchPersistent: async (name, dir, opts) => trackContext(await browserType(name).launchPersistentContext(dir, { headless: !process.env.LMCODE_HEADED, ...withDevice(opts) })),
  newContext: async (browser, opts) => trackContext(await browser.newContext(withDevice(opts))),
  newPage: async (browser, opts) => { const p = await browser.newPage(withDevice(opts)); track(p); return p; },
  contextNewPage: async ctx => { const p = await ctx.newPage(); track(p); return p; },
  evaluate: async (o, expr, arg) => JSON.stringify(serialize(await o.evaluate(expr, arg)) ?? null),
  autoDialog: (page, action, text) => {
    if (action !== 'accept' && action !== 'dismiss')
      throw new Error('auto_dialog action is "accept" or "dismiss"');
    logs(page).policy = { action, text };
  },
  clearLogs: page => { const l = logs(page); l.console.length = l.errors.length = l.failed.length = l.httpErrors.length = l.dialogs.length = 0; },
  filterOpts: (o, s) => {
    const f = json(s) || {};
    const page = pageOf(o);
    for (const k of ['hasText', 'hasNotText'])
      if (typeof f[k] === 'string')
        f[k] = textOrRegex(f[k]);
    for (const k of ['has', 'hasNot'])
      if (typeof f[k] === 'string')
        f[k] = page.locator(f[k]);
    return f;
  },
  requestOpts: s => {
    const o = json(s) || {};
    if (o.dataJson !== undefined) {
      o.data = o.dataJson;
      delete o.dataJson;
    }
    if (o.multipart) {
      for (const [k, v] of Object.entries(o.multipart)) {
        if (v && typeof v === 'object' && 'text' in v)
          o.multipart[k] = { name: v.name || k, mimeType: v.mimeType || 'text/plain', buffer: Buffer.from(v.text) };
      }
    }
    return o;
  },
  writeFile: (file, buf) => {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, buf);
  },
};

/** A stand-in for the null that page.goto() returns for about:/data: URLs. */
const noResponse = {
  url: () => '', status: () => 0, statusText: () => '', ok: () => false, headers: () => ({}),
  headerValue: async () => null, text: async () => '', json: async () => null,
  body: async () => Buffer.alloc(0), request: () => { throw new Error('No response for this navigation'); },
};

function finish(returns, v, label) {
  switch (returns) {
    case 'void': return null;
    case 'string':
      if (v === undefined || v === null)
        return '';
      return typeof v === 'string' ? v : JSON.stringify(serialize(v));
    case 'int': return Math.trunc(Number(v));
    case 'float': return Number(v);
    case 'bool': return Boolean(v);
    default:
      if (v === undefined || v === null) {
        if (returns === 'Response')
          return { h: register(noResponse) };
        throw new Error(`${label} returned nothing (expected ${returns})`);
      }
      return { h: register(v) };
  }
}

async function dispatch(msg) {
  if (msg.op === 'shutdown') {
    for (const x of [...live].reverse())
      await (x.close ? x.close() : x.dispose()).catch(() => {});
    return null;
  }
  const overloads = table.get(msg.type)?.get(msg.name);
  const ov = overloads && overloads[msg.ovl];
  if (!ov)
    throw new Error(`No implementation for ${msg.type}.${msg.name}`);
  let self;
  if (msg.type === 'Playwright')
    self = {};
  else {
    self = objects.get(msg.self);
    if (!self)
      throw new Error(`${msg.type} handle ${msg.self} was released or does not exist`);
  }
  const v = await ov.impl(self, msg.args, helpers);
  if (v && typeof v === 'object' && (msg.name === 'new_context' || msg.name === 'request_new'))
    live.add(v);
  return finish(ov.returns, v, `${msg.type}.${msg.name}`);
}

// `as_<type>(id)` free functions.
function lookup(id, type) {
  const o = objects.get(id);
  if (!o)
    throw new Error(`Handle ${id} does not exist`);
  return { h: id };
}

port.on('message', async msg => {
  let reply;
  try {
    reply = msg.op === 'as' ? { ok: true, value: lookup(msg.id, msg.type) } : { ok: true, value: await dispatch(msg) };
  } catch (e) {
    reply = { ok: false, error: String(e && e.message || e).replace(ANSI, '') };
  }
  port.postMessage(reply);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});

port.postMessage({ ready: true });

process.on('exit', () => {
  Atomics.store(flag, 0, 2);
  Atomics.notify(flag, 0);
});
process.on('unhandledRejection', () => {});
