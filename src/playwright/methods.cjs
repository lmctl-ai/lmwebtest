/**
 * lmcode host surface for Playwright.
 *
 * One table drives both sides of the host: the schema/signatures that the
 * lmcode compiler binds to, and the implementations that the worker runs
 * against real Playwright objects. Implementations receive the Playwright
 * object, the already converted arguments, and a helper bag (see worker.js).
 *
 * Conventions
 *  - Options bags are JSON strings (`"{\"timeout\":5000}"`), parsed by the host.
 *  - File inputs ("files") are a path, a JSON array of paths, or a JSON array of
 *    in-memory files: {"name","mimeType","text"|"base64"}.
 *  - `call` / `call_id` on every handle reach the *entire* Playwright API by
 *    reflection, with dotted paths ("keyboard.press", "mouse.click").
 */

'use strict';

/** Handle types exposed to lmcode. */
const HANDLE_TYPES = [
  'Playwright', 'Browser', 'BrowserContext', 'Page', 'Frame', 'Locator',
  'Request', 'Response', 'Download', 'FileChooser', 'Dialog',
  'ApiContext', 'ApiResponse', 'Object',
];

/** Playwright class name -> lmcode type, for reflective results. */
const CLASS_TO_TYPE = {
  Browser: 'Browser', BrowserContext: 'BrowserContext', Page: 'Page', Frame: 'Frame',
  Locator: 'Locator', Request: 'Request', Response: 'Response', Download: 'Download',
  FileChooser: 'FileChooser', Dialog: 'Dialog', APIRequestContext: 'ApiContext',
  APIResponse: 'ApiResponse',
  ElementHandle: 'Object', JSHandle: 'Object', ConsoleMessage: 'Object', Worker: 'Object',
  WebSocket: 'Object', Video: 'Object', CDPSession: 'Object', Tracing: 'Object',
  Keyboard: 'Object', Mouse: 'Object', Touchscreen: 'Object', Clock: 'Object',
  Coverage: 'Object', Accessibility: 'Object', WebError: 'Object', Route: 'Object',
};

/** type -> name -> overloads [{params, returns, impl}] */
const table = new Map();

function def(type, name, params, returns, impl) {
  if (!table.has(type))
    table.set(type, new Map());
  const methods = table.get(type);
  if (!methods.has(name))
    methods.set(name, []);
  methods.get(name).push({ params, returns, impl });
}

const S = 'string', I = 'int', F = 'float', B = 'bool', V = 'void';

// ---------------------------------------------------------------------------
// Generic reflection on every handle type.
// ---------------------------------------------------------------------------
for (const type of HANDLE_TYPES) {
  def(type, 'id', [], I, (o, a, h) => h.idOf(o));
  def(type, 'call', [S, S], S, (o, a, h) => h.reflect(o, a[0], a[1]));
  def(type, 'call_id', [S, S], I, async (o, a, h) => h.idOf(await h.reflectRaw(o, a[0], a[1])));
  def(type, 'release', [], V, (o, a, h) => h.release(o));
}

// ---------------------------------------------------------------------------
// Playwright (context `pw`)
// ---------------------------------------------------------------------------
def('Playwright', 'launch', [S], 'Browser', (o, a, h) => h.launch(a[0], undefined));
def('Playwright', 'launch', [S, S], 'Browser', (o, a, h) => h.launch(a[0], h.json(a[1])));
def('Playwright', 'launch_persistent', [S, S, S], 'BrowserContext', (o, a, h) => h.launchPersistent(a[0], a[1], h.json(a[2])));
def('Playwright', 'connect', [S, S], 'Browser', (o, a, h) => h.browserType(a[0]).connect(a[1]));
def('Playwright', 'connect_over_cdp', [S], 'Browser', (o, a, h) => h.browserType('chromium').connectOverCDP(a[0]));
def('Playwright', 'executable_path', [S], S, (o, a, h) => h.browserType(a[0]).executablePath());
def('Playwright', 'env', [S], S, (o, a) => process.env[a[0]] ?? '');
def('Playwright', 'devices', [], S, (o, a, h) => Object.keys(h.pw.devices));
def('Playwright', 'device', [S], S, (o, a, h) => {
  const d = h.pw.devices[a[0]];
  if (!d)
    throw new Error(`Unknown device "${a[0]}"`);
  return d;
});
def('Playwright', 'set_test_id_attribute', [S], V, (o, a, h) => h.pw.selectors.setTestIdAttribute(a[0]));
def('Playwright', 'request_new', [], 'ApiContext', (o, a, h) => h.pw.request.newContext());
def('Playwright', 'request_new', [S], 'ApiContext', (o, a, h) => h.pw.request.newContext(h.json(a[0])));

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------
def('Browser', 'new_context', [], 'BrowserContext', (o, a, h) => h.newContext(o, undefined));
def('Browser', 'new_context', [S], 'BrowserContext', (o, a, h) => h.newContext(o, h.json(a[0])));
def('Browser', 'new_page', [], 'Page', (o, a, h) => h.newPage(o, undefined));
def('Browser', 'new_page', [S], 'Page', (o, a, h) => h.newPage(o, h.json(a[0])));
def('Browser', 'version', [], S, o => o.version());
def('Browser', 'is_connected', [], B, o => o.isConnected());
def('Browser', 'contexts_count', [], I, o => o.contexts().length);
def('Browser', 'close', [], V, o => o.close());

// ---------------------------------------------------------------------------
// BrowserContext
// ---------------------------------------------------------------------------
def('BrowserContext', 'new_page', [], 'Page', (o, a, h) => h.contextNewPage(o));
def('BrowserContext', 'pages_count', [], I, o => o.pages().length);
def('BrowserContext', 'page_at', [I], 'Page', (o, a) => {
  const p = o.pages()[a[0]];
  if (!p)
    throw new Error(`No page at index ${a[0]}`);
  return p;
});
def('BrowserContext', 'wait_for_page', [I], 'Page', async (o, a, h) => {
  const p = await o.waitForEvent('page', { timeout: a[0] });
  h.track(p);
  return p;
});
def('BrowserContext', 'cookies', [], S, o => o.cookies());
def('BrowserContext', 'cookies', [S], S, (o, a, h) => o.cookies(h.json(a[0])));
def('BrowserContext', 'add_cookies', [S], V, (o, a, h) => o.addCookies(h.json(a[0])));
def('BrowserContext', 'clear_cookies', [], V, o => o.clearCookies());
def('BrowserContext', 'storage_state', [], S, o => o.storageState());
def('BrowserContext', 'storage_state', [S], S, (o, a) => o.storageState({ path: a[0] }));
def('BrowserContext', 'grant_permissions', [S], V, (o, a, h) => o.grantPermissions(h.json(a[0])));
def('BrowserContext', 'clear_permissions', [], V, o => o.clearPermissions());
def('BrowserContext', 'set_geolocation', [F, F], V, (o, a) => o.setGeolocation({ latitude: a[0], longitude: a[1] }));
def('BrowserContext', 'set_offline', [B], V, (o, a) => o.setOffline(a[0]));
def('BrowserContext', 'set_default_timeout', [I], V, (o, a) => o.setDefaultTimeout(a[0]));
def('BrowserContext', 'set_default_navigation_timeout', [I], V, (o, a) => o.setDefaultNavigationTimeout(a[0]));
def('BrowserContext', 'set_extra_http_headers', [S], V, (o, a, h) => o.setExtraHTTPHeaders(h.json(a[0])));
def('BrowserContext', 'add_init_script', [S], V, (o, a) => o.addInitScript(a[0]));
def('BrowserContext', 'tracing_start', [], V, o => o.tracing.start({ screenshots: true, snapshots: true }));
def('BrowserContext', 'tracing_start', [S], V, (o, a, h) => o.tracing.start(h.json(a[0])));
def('BrowserContext', 'tracing_stop', [S], V, (o, a) => o.tracing.stop({ path: a[0] }));
def('BrowserContext', 'close', [], V, o => o.close());
for (const type of ['BrowserContext', 'Page']) {
  def(type, 'route_fulfill', [S, I, S, S], V, (o, a) => o.route(a[0], r => r.fulfill({ status: a[1], body: a[2], contentType: a[3] })));
  def(type, 'route_fulfill_json', [S, I, S], V, (o, a) => o.route(a[0], r => r.fulfill({ status: a[1], contentType: 'application/json', body: a[2] })));
  def(type, 'route_abort', [S], V, (o, a) => o.route(a[0], r => r.abort()));
  def(type, 'route_abort', [S, S], V, (o, a) => o.route(a[0], r => r.abort(a[1])));
  def(type, 'route_continue', [S, S], V, (o, a, h) => o.route(a[0], r => r.continue(h.json(a[1]))));
  def(type, 'route_from_har', [S], V, (o, a) => o.routeFromHAR(a[0], { notFound: 'fallback' }));
  def(type, 'route_from_har', [S, S], V, (o, a, h) => o.routeFromHAR(a[0], h.json(a[1])));
  def(type, 'unroute_all', [], V, o => o.unrouteAll({ behavior: 'ignoreErrors' }));
}

// ---------------------------------------------------------------------------
// Actions shared by Page / Frame (selector first) and Locator.
// ---------------------------------------------------------------------------
// [name, extra params, returns, call(target, args, opts)]
const ACTIONS = [
  ['click', [], V], ['dblclick', [], V], ['hover', [], V], ['tap', [], V],
  ['focus', [], V], ['check', [], V], ['uncheck', [], V],
  ['fill', [S], V], ['press', [S], V], ['dispatch_event', [S], V],
  ['select_option', [S], S], ['set_input_files', [S], V],
  ['text_content', [], S], ['inner_text', [], S], ['inner_html', [], S],
  ['input_value', [], S], ['get_attribute', [S], S],
  ['is_visible', [], B], ['is_hidden', [], B], ['is_enabled', [], B],
  ['is_disabled', [], B], ['is_checked', [], B], ['is_editable', [], B],
];
// Read-only probes take no options overload here (use call() for timeouts).
const NO_OPTS = new Set(['focus', 'text_content', 'inner_text', 'inner_html', 'input_value',
  'is_visible', 'is_hidden', 'is_enabled', 'is_disabled', 'is_checked', 'is_editable']);
// Names whose Playwright spelling differs from camelCase(name).
const PW_NAME = { dispatch_event: 'dispatchEvent', select_option: 'selectOption', set_input_files: 'setInputFiles' };
const camel = n => PW_NAME[n] || n.replace(/_([a-z])/g, (m, c) => c.toUpperCase());

function prep(name, rest, h) {
  // Convert string option args into the values Playwright expects.
  if (name === 'select_option')
    return [h.selectValues(rest[0])];
  if (name === 'set_input_files')
    return [h.files(rest[0])];
  if (name === 'dispatch_event')
    return [rest[0]];
  return rest;
}

for (const type of ['Page', 'Frame', 'Locator']) {
  const isLocator = type === 'Locator';
  for (const [name, extra, returns] of ACTIONS) {
    const pw = camel(name);
    const lead = isLocator ? [] : [S];
    const withOpts = !NO_OPTS.has(name);
    const invoke = (o, a, h, opts) => {
      const sel = isLocator ? [] : [a[0]];
      const rest = prep(name, a.slice(sel.length, sel.length + extra.length), h);
      const tail = opts === undefined ? [] : [opts];
      return o[pw](...sel, ...rest, ...tail);
    };
    def(type, name, [...lead, ...extra], returns, (o, a, h) => invoke(o, a, h, undefined));
    if (withOpts)
      def(type, name, [...lead, ...extra, S], returns, (o, a, h) => invoke(o, a, h, h.json(a[a.length - 1])));
  }
  // Locator factories.
  def(type, 'locator', [S], 'Locator', (o, a) => o.locator(a[0]));
  def(type, 'get_by_role', [S], 'Locator', (o, a) => o.getByRole(a[0]));
  def(type, 'get_by_role', [S, S], 'Locator', (o, a, h) => o.getByRole(a[0], h.json(a[1])));
  for (const [n, pw] of [['get_by_text', 'getByText'], ['get_by_label', 'getByLabel'],
    ['get_by_placeholder', 'getByPlaceholder'], ['get_by_alt_text', 'getByAltText'],
    ['get_by_title', 'getByTitle'], ['get_by_test_id', 'getByTestId']]) {
    def(type, n, [S], 'Locator', (o, a) => o[pw](a[0]));
    if (n !== 'get_by_test_id')
      def(type, n, [S, B], 'Locator', (o, a) => o[pw](a[0], { exact: a[1] }));
  }
  def(type, 'evaluate', [S], S, (o, a, h) => h.evaluate(o, a[0], undefined));
  def(type, 'evaluate', [S, S], S, (o, a, h) => h.evaluate(o, a[0], h.json(a[1])));
  def(type, 'wait_for_load_state', [S], V, (o, a) => o.waitForLoadState ? o.waitForLoadState(a[0]) : undefined);
}
// Page / Frame only (selector-first helpers)
for (const type of ['Page', 'Frame']) {
  def(type, 'goto', [S], 'Response', (o, a) => o.goto(a[0]));
  def(type, 'goto', [S, S], 'Response', (o, a, h) => o.goto(a[0], h.json(a[1])));
  def(type, 'url', [], S, o => o.url());
  def(type, 'content', [], S, o => o.content());
  def(type, 'set_content', [S], V, (o, a) => o.setContent(a[0]));
  def(type, 'wait_for_selector', [S], 'Locator', async (o, a) => { await o.waitForSelector(a[0]); return o.locator(a[0]); });
  def(type, 'wait_for_selector', [S, S], 'Locator', async (o, a, h) => { await o.waitForSelector(a[0], h.json(a[1])); return o.locator(a[0]); });
  def(type, 'wait_for_url', [S], V, (o, a, h) => o.waitForURL(h.urlMatcher(a[0])));
  def(type, 'wait_for_function', [S], V, (o, a) => o.waitForFunction(a[0]));
  def(type, 'wait_for_function', [S, S], V, (o, a, h) => o.waitForFunction(a[0], h.json(a[1])));
  def(type, 'add_script_tag', [S], V, (o, a) => o.addScriptTag({ content: a[0] }));
  def(type, 'add_style_tag', [S], V, (o, a) => o.addStyleTag({ content: a[0] }));
  def(type, 'frame_locator', [S], 'Locator', (o, a) => o.frameLocator(a[0]).locator(':root'));
}
def('Frame', 'name', [], S, o => o.name());
def('Frame', 'title', [], S, o => o.title());
def('Frame', 'is_detached', [], B, o => o.isDetached());
def('Frame', 'child_frames_count', [], I, o => o.childFrames().length);
def('Frame', 'child_frame_at', [I], 'Frame', (o, a) => o.childFrames()[a[0]]);

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
def('Page', 'title', [], S, o => o.title());
def('Page', 'reload', [], 'Response', o => o.reload());
def('Page', 'go_back', [], 'Response', o => o.goBack());
def('Page', 'go_forward', [], 'Response', o => o.goForward());
def('Page', 'bring_to_front', [], V, o => o.bringToFront());
def('Page', 'close', [], V, o => o.close());
def('Page', 'is_closed', [], B, o => o.isClosed());
def('Page', 'context', [], 'BrowserContext', o => o.context());
def('Page', 'main_frame', [], 'Frame', o => o.mainFrame());
def('Page', 'frame', [S], 'Frame', (o, a) => {
  const f = o.frame(a[0]);
  if (!f)
    throw new Error(`No frame named "${a[0]}"`);
  return f;
});
def('Page', 'frames_count', [], I, o => o.frames().length);
def('Page', 'frame_at', [I], 'Frame', (o, a) => o.frames()[a[0]]);
def('Page', 'set_viewport', [I, I], V, (o, a) => o.setViewportSize({ width: a[0], height: a[1] }));
def('Page', 'set_default_timeout', [I], V, (o, a) => o.setDefaultTimeout(a[0]));
def('Page', 'set_default_navigation_timeout', [I], V, (o, a) => o.setDefaultNavigationTimeout(a[0]));
def('Page', 'set_extra_http_headers', [S], V, (o, a, h) => o.setExtraHTTPHeaders(h.json(a[0])));
def('Page', 'emulate_media', [S], V, (o, a, h) => o.emulateMedia(h.json(a[0])));
def('Page', 'add_init_script', [S], V, (o, a) => o.addInitScript(a[0]));
def('Page', 'wait_for_timeout', [I], V, (o, a) => o.waitForTimeout(a[0]));
def('Page', 'screenshot', [S], V, async (o, a) => { await o.screenshot({ path: a[0] }); });
def('Page', 'screenshot', [S, B], V, async (o, a) => { await o.screenshot({ path: a[0], fullPage: a[1] }); });
def('Page', 'screenshot', [S, S], V, async (o, a, h) => { await o.screenshot({ path: a[0], ...h.json(a[1]) }); });
def('Page', 'pdf', [S], V, async (o, a) => { await o.pdf({ path: a[0] }); });
def('Page', 'aria_snapshot', [], S, o => o.locator('body').ariaSnapshot());
def('Page', 'keyboard_press', [S], V, (o, a) => o.keyboard.press(a[0]));
def('Page', 'keyboard_type', [S], V, (o, a) => o.keyboard.type(a[0]));
def('Page', 'keyboard_down', [S], V, (o, a) => o.keyboard.down(a[0]));
def('Page', 'keyboard_up', [S], V, (o, a) => o.keyboard.up(a[0]));
def('Page', 'keyboard_insert_text', [S], V, (o, a) => o.keyboard.insertText(a[0]));
def('Page', 'mouse_move', [F, F], V, (o, a) => o.mouse.move(a[0], a[1]));
def('Page', 'mouse_click', [F, F], V, (o, a) => o.mouse.click(a[0], a[1]));
def('Page', 'mouse_dblclick', [F, F], V, (o, a) => o.mouse.dblclick(a[0], a[1]));
def('Page', 'mouse_down', [], V, o => o.mouse.down());
def('Page', 'mouse_up', [], V, o => o.mouse.up());
def('Page', 'mouse_wheel', [F, F], V, (o, a) => o.mouse.wheel(a[0], a[1]));
def('Page', 'drag_and_drop', [S, S], V, (o, a) => o.dragAndDrop(a[0], a[1]));
// Event-style APIs as declarative helpers.
def('Page', 'auto_dialog', [S], V, (o, a, h) => h.autoDialog(o, a[0], undefined));
def('Page', 'auto_dialog', [S, S], V, (o, a, h) => h.autoDialog(o, a[0], a[1]));
def('Page', 'dialog_log', [], S, (o, a, h) => h.logs(o).dialogs);
def('Page', 'console_log', [], S, (o, a, h) => h.logs(o).console);
def('Page', 'page_errors', [], S, (o, a, h) => h.logs(o).errors);
def('Page', 'failed_requests', [], S, (o, a, h) => h.logs(o).failed);
def('Page', 'http_errors', [], S, (o, a, h) => h.logs(o).httpErrors);
def('Page', 'clear_logs', [], V, (o, a, h) => h.clearLogs(o));
def('Page', 'expect_page', [S, S], V, (o, a, h) => h.expectMatcher(o, a[0], a[1], false));
def('Page', 'expect_not_page', [S, S], V, (o, a, h) => h.expectMatcher(o, a[0], a[1], true));

// Click-and-wait: arm the wait before the action so no event is missed.
for (const type of ['Page', 'Locator']) {
  const trigger = (o, a, h) => type === 'Page' ? () => o.click(a[0]) : () => o.click();
  const lead = type === 'Page' ? [S] : [];
  const n = lead.length;
  def(type, 'click_download', lead, 'Download', async (o, a, h) => {
    const [d] = await Promise.all([h.pageOf(o).waitForEvent('download'), trigger(o, a, h)()]);
    return d;
  });
  def(type, 'click_popup', lead, 'Page', async (o, a, h) => {
    const [p] = await Promise.all([h.pageOf(o).waitForEvent('popup'), trigger(o, a, h)()]);
    h.track(p);
    return p;
  });
  def(type, 'click_file_chooser', [...lead, S], V, async (o, a, h) => {
    const [fc] = await Promise.all([h.pageOf(o).waitForEvent('filechooser'), trigger(o, a, h)()]);
    await fc.setFiles(h.files(a[n]));
  });
  def(type, 'click_wait_file_chooser', lead, 'FileChooser', async (o, a, h) => {
    const [fc] = await Promise.all([h.pageOf(o).waitForEvent('filechooser'), trigger(o, a, h)()]);
    return fc;
  });
  def(type, 'click_response', [...lead, S], 'Response', async (o, a, h) => {
    const [r] = await Promise.all([h.pageOf(o).waitForResponse(h.urlMatcher(a[n])), trigger(o, a, h)()]);
    return r;
  });
  def(type, 'click_request', [...lead, S], 'Request', async (o, a, h) => {
    const [r] = await Promise.all([h.pageOf(o).waitForRequest(h.urlMatcher(a[n])), trigger(o, a, h)()]);
    return r;
  });
}

// ---------------------------------------------------------------------------
// Locator-only
// ---------------------------------------------------------------------------
def('Locator', 'count', [], I, o => o.count());
def('Locator', 'first', [], 'Locator', o => o.first());
def('Locator', 'last', [], 'Locator', o => o.last());
def('Locator', 'nth', [I], 'Locator', (o, a) => o.nth(a[0]));
def('Locator', 'filter', [S], 'Locator', (o, a, h) => o.filter(h.filterOpts(o, a[0])));
def('Locator', 'page', [], 'Page', o => o.page());
def('Locator', 'clear', [], V, o => o.clear());
def('Locator', 'blur', [], V, o => o.blur());
def('Locator', 'press_sequentially', [S], V, (o, a) => o.pressSequentially(a[0]));
def('Locator', 'set_checked', [B], V, (o, a) => o.setChecked(a[0]));
def('Locator', 'scroll_into_view', [], V, o => o.scrollIntoViewIfNeeded());
def('Locator', 'highlight', [], V, o => o.highlight());
def('Locator', 'drag_to', [S], V, (o, a) => o.dragTo(o.page().locator(a[0])));
def('Locator', 'wait_for', [], V, o => o.waitFor());
def('Locator', 'wait_for', [S], V, (o, a) => o.waitFor({ state: a[0] }));
def('Locator', 'wait_for', [S, I], V, (o, a) => o.waitFor({ state: a[0], timeout: a[1] }));
def('Locator', 'all_text_contents', [], S, o => o.allTextContents());
def('Locator', 'all_inner_texts', [], S, o => o.allInnerTexts());
def('Locator', 'bounding_box', [], S, o => o.boundingBox());
def('Locator', 'aria_snapshot', [], S, o => o.ariaSnapshot());
def('Locator', 'screenshot', [S], V, async (o, a) => { await o.screenshot({ path: a[0] }); });
// Web-first assertions (`await expect(locator).toX()`), retried until timeout.
def('Locator', 'expect', [S, S], V, (o, a, h) => h.expectMatcher(o, a[0], a[1], false));
def('Locator', 'expect_not', [S, S], V, (o, a, h) => h.expectMatcher(o, a[0], a[1], true));

// ---------------------------------------------------------------------------
// Request / Response / Download / FileChooser / Dialog
// ---------------------------------------------------------------------------
def('Request', 'url', [], S, o => o.url());
def('Request', 'method', [], S, o => o.method());
def('Request', 'headers', [], S, o => o.headers());
def('Request', 'post_data', [], S, o => o.postData());
def('Request', 'resource_type', [], S, o => o.resourceType());
def('Request', 'failure', [], S, o => o.failure()?.errorText ?? '');
def('Request', 'is_navigation_request', [], B, o => o.isNavigationRequest());
def('Request', 'response', [], 'Response', o => o.response());

def('Response', 'url', [], S, o => o.url());
def('Response', 'status', [], I, o => o.status());
def('Response', 'status_text', [], S, o => o.statusText());
def('Response', 'ok', [], B, o => o.ok());
def('Response', 'headers', [], S, o => o.headers());
def('Response', 'header_value', [S], S, async (o, a) => (await o.headerValue(a[0])) ?? '');
def('Response', 'text', [], S, o => o.text());
def('Response', 'json', [], S, async o => JSON.stringify(await o.json()));
def('Response', 'body_to_file', [S], V, async (o, a, h) => h.writeFile(a[0], await o.body()));
def('Response', 'request', [], 'Request', o => o.request());

def('Download', 'url', [], S, o => o.url());
def('Download', 'suggested_filename', [], S, o => o.suggestedFilename());
def('Download', 'save_as', [S], V, (o, a) => o.saveAs(a[0]));
def('Download', 'path', [], S, async o => (await o.path()) ?? '');
def('Download', 'failure', [], S, async o => (await o.failure()) ?? '');
def('Download', 'cancel', [], V, o => o.cancel());
def('Download', 'delete', [], V, o => o.delete());

def('FileChooser', 'is_multiple', [], B, o => o.isMultiple());
def('FileChooser', 'set_files', [S], V, (o, a, h) => o.setFiles(h.files(a[0])));

def('Dialog', 'kind', [], S, o => o.type());
def('Dialog', 'message', [], S, o => o.message());
def('Dialog', 'default_value', [], S, o => o.defaultValue());
def('Dialog', 'accept', [], V, o => o.accept());
def('Dialog', 'accept', [S], V, (o, a) => o.accept(a[0]));
def('Dialog', 'dismiss', [], V, o => o.dismiss());

// ---------------------------------------------------------------------------
// APIRequestContext / APIResponse (HTTP without a page)
// ---------------------------------------------------------------------------
for (const verb of ['get', 'post', 'put', 'patch', 'delete', 'head']) {
  def('ApiContext', verb, [S], 'ApiResponse', (o, a) => o[verb](a[0]));
  def('ApiContext', verb, [S, S], 'ApiResponse', (o, a, h) => o[verb](a[0], h.requestOpts(a[1])));
}
def('ApiContext', 'fetch', [S, S], 'ApiResponse', (o, a, h) => o.fetch(a[0], h.requestOpts(a[1])));
def('ApiContext', 'storage_state', [], S, o => o.storageState());
def('ApiContext', 'dispose', [], V, o => o.dispose());
def('ApiResponse', 'url', [], S, o => o.url());
def('ApiResponse', 'status', [], I, o => o.status());
def('ApiResponse', 'status_text', [], S, o => o.statusText());
def('ApiResponse', 'ok', [], B, o => o.ok());
def('ApiResponse', 'headers', [], S, o => o.headers());
def('ApiResponse', 'text', [], S, o => o.text());
def('ApiResponse', 'json', [], S, async o => JSON.stringify(await o.json()));
def('ApiResponse', 'body_to_file', [S], V, async (o, a, h) => h.writeFile(a[0], await o.body()));

// ---------------------------------------------------------------------------
// Free functions: turn a handle id back into a typed handle.
// ---------------------------------------------------------------------------
const FUNCTIONS = [];
for (const type of HANDLE_TYPES.filter(t => t !== 'Playwright')) {
  const name = 'as_' + type.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  FUNCTIONS.push({ name, params: [I], returns: type, type });
}

// ---------------------------------------------------------------------------
// Schema / signature views
// ---------------------------------------------------------------------------
function overloadsOf(type, name) {
  return table.get(type).get(name);
}

function buildSchema() {
  const types = {};
  for (const type of HANDLE_TYPES) {
    const methods = {};
    const entries = table.get(type) || new Map();
    for (const name of [...entries.keys()].sort())
      methods[name] = entries.get(name).map(o => ({ params: o.params, returns: o.returns }));
    types[type] = { methods };
  }
  const functions = {};
  for (const f of FUNCTIONS)
    functions[f.name] = [{ params: f.params, returns: f.returns }];
  return {
    'dsl.schema': 2,
    'name': 'playwright',
    'types': types,
    'functions': functions,
    'context': { pw: 'Playwright' },
  };
}

module.exports = { HANDLE_TYPES, CLASS_TO_TYPE, FUNCTIONS, table, overloadsOf, buildSchema };
