import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { StrList } from './std.js';
import { checkBrowserError } from '../cli.js';

export { checkBrowserError };

export class Web {
  constructor() {
    this._browser = null;
    this._context = null;
    this._defaultTimeout = 10000;
    this._viewport = { width: 1280, height: 720 };
    this._userAgent = null;
    this._extraHeaders = {};
    this._pages = [];
  }

  async _ensureBrowser() {
    if (!this._browser) {
      try {
        this._browser = await chromium.launch({ headless: true });
      } catch (err) {
        throw checkBrowserError(err);
      }
    }
    if (!this._context) {
      const options = {
        viewport: this._viewport,
      };
      if (this._userAgent) options.userAgent = this._userAgent;
      if (Object.keys(this._extraHeaders).length > 0) options.extraHTTPHeaders = this._extraHeaders;
      this._context = await this._browser.newContext(options);
      this._context.setDefaultTimeout(this._defaultTimeout);
    }
    return this._context;
  }

  async navigate(url, timeoutMs) {
    const context = await this._ensureBrowser();
    const pwPage = await context.newPage();
    const timeout = timeoutMs !== undefined ? Number(timeoutMs) : this._defaultTimeout;
    pwPage.setDefaultTimeout(timeout);

    let status = 0;
    try {
      const response = await pwPage.goto(String(url), {
        timeout,
        waitUntil: 'domcontentloaded',
      });
      if (response) {
        status = response.status();
      }
    } catch (err) {
      throw checkBrowserError(err);
    }

    const page = new Page(this, pwPage, String(url), status, timeout);
    this._pages.push(page);
    return page;
  }

  set_timeout(timeoutMs) {
    this._defaultTimeout = Number(timeoutMs);
    if (this._context) {
      this._context.setDefaultTimeout(this._defaultTimeout);
    }
  }

  set_viewport(width, height) {
    this._viewport = { width: Number(width), height: Number(height) };
  }

  set_user_agent(ua) {
    this._userAgent = String(ua);
  }

  set_header(name, value) {
    this._extraHeaders[String(name)] = String(value);
  }

  async close() {
    if (this._context) {
      try { await this._context.close(); } catch {}
      this._context = null;
    }
    if (this._browser) {
      try { await this._browser.close(); } catch {}
      this._browser = null;
    }
    this._pages = [];
  }
}

export class Page {
  constructor(web, pwPage, url, status, defaultTimeout) {
    this._web = web;
    this._page = pwPage;
    this._url = url;
    this._status = status;
    this._defaultTimeout = defaultTimeout;
  }

  url() {
    return this._page.url() || this._url;
  }

  async title() {
    return await this._page.title();
  }

  status() {
    return BigInt(this._status);
  }

  async html(selector) {
    if (selector !== undefined) {
      const el = await this._page.$(String(selector));
      if (!el) return '';
      return await el.evaluate(e => e.outerHTML);
    }
    return await this._page.content();
  }

  async save_html(path) {
    const content = await this._page.content();
    writeFileSync(String(path), content, 'utf8');
  }

  async screenshot(path, fullPage = true) {
    await this._page.screenshot({
      path: String(path),
      fullPage: Boolean(fullPage),
    });
  }

  async wait_for(selector, timeoutMs) {
    const timeout = timeoutMs !== undefined ? Number(timeoutMs) : this._defaultTimeout;
    try {
      const locator = this._page.locator(String(selector)).first();
      await locator.waitFor({ state: 'visible', timeout });
      const handle = await locator.elementHandle();
      return new Element(handle, this._page);
    } catch (err) {
      throw checkBrowserError(err);
    }
  }

  async wait_for_timeout(ms) {
    await this._page.waitForTimeout(Number(ms));
  }

  async wait_for_load() {
    try {
      await this._page.waitForLoadState('networkidle', { timeout: this._defaultTimeout });
    } catch {
      // networkidle may time out on streaming sites, fall back to load
      try {
        await this._page.waitForLoadState('load', { timeout: this._defaultTimeout });
      } catch {}
    }
  }

  async select(selector) {
    const handles = await this._page.$$(String(selector));
    const elements = handles.map(h => new Element(h, this._page));
    return new ElementList(elements);
  }

  async select_one(selector) {
    const handle = await this._page.$(String(selector));
    if (!handle) throw new Error(`Element not found for selector: ${selector}`);
    return new Element(handle, this._page);
  }

  async has(selector) {
    const handle = await this._page.$(String(selector));
    return handle !== null;
  }

  async count(selector) {
    const handles = await this._page.$$(String(selector));
    return BigInt(handles.length);
  }

  async text(selector) {
    const el = await this._page.locator(String(selector)).first();
    return (await el.innerText()).trim();
  }

  async inner_html(selector) {
    const el = await this._page.locator(String(selector)).first();
    return await el.innerHTML();
  }

  async outer_html(selector) {
    const el = await this._page.locator(String(selector)).first();
    return await el.evaluate(e => e.outerHTML);
  }

  async click(selector) {
    await this._page.click(String(selector));
  }

  async fill(selector, text) {
    await this._page.fill(String(selector), String(text));
  }

  async press(selector, key) {
    await this._page.press(String(selector), String(key));
  }

  async eval(script) {
    const result = await this._page.evaluate(String(script));
    return result !== undefined && result !== null ? String(result) : '';
  }
}

export class Element {
  constructor(handle, pwPage) {
    this._handle = handle;
    this._page = pwPage;
  }

  async text() {
    return (await this._handle.innerText()).trim();
  }

  async inner_html() {
    return await this._handle.innerHTML();
  }

  async outer_html() {
    return await this._handle.evaluate(e => e.outerHTML);
  }

  async attr(name) {
    const val = await this._handle.getAttribute(String(name));
    return val !== null ? val : '';
  }

  async has_attr(name) {
    const val = await this._handle.getAttribute(String(name));
    return val !== null;
  }

  async is_visible() {
    return await this._handle.isVisible();
  }

  async click() {
    await this._handle.click();
  }

  async fill(text) {
    await this._handle.fill(String(text));
  }

  async press(key) {
    await this._handle.press(String(key));
  }

  async select(selector) {
    const handles = await this._handle.$$(String(selector));
    const elements = handles.map(h => new Element(h, this._page));
    return new ElementList(elements);
  }

  async select_one(selector) {
    const handle = await this._handle.$(String(selector));
    if (!handle) throw new Error(`Sub-element not found for selector: ${selector}`);
    return new Element(handle, this._page);
  }

  async count(selector) {
    const handles = await this._handle.$$(String(selector));
    return BigInt(handles.length);
  }
}

export class ElementList {
  constructor(elements = []) {
    this._elements = [...elements];
  }

  len() {
    return BigInt(this._elements.length);
  }

  at(idx) {
    const i = Number(idx);
    if (i < 0 || i >= this._elements.length) {
      throw new Error(`ElementList index out of range: ${i} (length: ${this._elements.length})`);
    }
    return this._elements[i];
  }

  async texts() {
    const texts = [];
    for (const el of this._elements) {
      texts.push(await el.text());
    }
    return new StrList(texts);
  }
}
