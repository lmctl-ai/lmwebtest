import { test, expect } from '@playwright/test';

// Ownership: the localweb team authors and maintains this workspace's test cases.
// This starter is a hand-off scaffold, not a complete localweb regression suite.
// Localweb owners should add routes, titles, selectors, error checks and screenshots.
test('home smoke test', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('main#main')).toBeVisible();
});
