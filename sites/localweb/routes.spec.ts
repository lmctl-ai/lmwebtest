import { test, expect } from '@playwright/test';

const routes = [
  { name: 'overview', path: '/', title: 'Overview', selectors: ['[data-testid="page-intro"]'] },
  { name: 'tasks', path: '/tasks', title: 'Tasks', selectors: ['[data-testid="page-intro"]', 'form[action="/tasks"]', 'table'] },
  { name: 'running', path: '/running', title: 'Running', selectors: ['section table, main#main p:has-text("Activity has not yet been observed")'] },
  { name: 'math-inbox', path: '/comm/math', title: 'Math inbox', selectors: ['section[aria-label="Requests and replies"]'] },
  { name: 'session', path: '', title: 'Session:', selectors: ['#session-detail', '#comm-messages'] },
];

for (const route of routes) {
  test(`${route.name}: live route is healthy`, async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    const httpErrors: string[] = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('requestfailed', request => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
    page.on('response', response => { if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`); });

    let path = route.path;
    if (route.name === 'session') {
      const tasks = await page.goto('/tasks', { waitUntil: 'load' });
      expect(tasks?.status()).toBe(200);
      const link = page.locator('a[href^="/sessions/"]').first();
      await expect(link).toBeVisible();
      path = (await link.getAttribute('href'))!;
      expect(path).toMatch(/^\/sessions\/[^/]+\/[^/?#]+$/);
    }
    const response = await page.goto(path, { waitUntil: 'load' });
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(new RegExp(route.title));
    await expect(page.locator('main#main')).toBeVisible();
    await expect(page.locator('h1')).toContainText(route.title);
    for (const selector of route.selectors) await expect(page.locator(selector).first()).toBeVisible();

    // Load lazy images too, without clicking or submitting live application controls.
    await page.locator('img').evaluateAll(images => images.forEach(image => { image.loading = 'eager'; }));
    await expect.poll(() => page.locator('img').evaluateAll(images => images.filter(image => !image.complete || image.naturalWidth === 0).map(image => image.currentSrc || image.src))).toEqual([]);
    const screenshot = testInfo.outputPath(`${route.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach(route.name, { path: screenshot, contentType: 'image/png' });
    expect(consoleErrors, 'console errors').toEqual([]);
    expect(pageErrors, 'uncaught page errors').toEqual([]);
    expect(failedRequests, 'failed requests').toEqual([]);
    expect(httpErrors, 'HTTP resource errors').toEqual([]);
  });
}
