import { test as base, expect, type Page } from '@playwright/test';

async function _createFile(page: Page, name: string, content = '') {
  await page.click('#add-file-btn');
  await page.waitForSelector('#create-form[style*="block"], #create-form:not([style*="none"])');
  await page.fill('#create-name', name);
  if (content) await page.fill('#create-content', content);
  await page.click('#new-item-form button[type="submit"]');
  await expect(page.locator(`tr[data-name="${name}"]`)).toBeVisible();
}

async function _createFolder(page: Page, name: string) {
  await page.click('#add-folder-btn');
  await page.waitForSelector('#create-form[style*="block"], #create-form:not([style*="none"])');
  await page.fill('#create-name', name);
  await page.click('#new-item-form button[type="submit"]');
  await expect(page.locator(`tr[data-name="${name}"]`)).toBeVisible();
}

async function _deleteFile(page: Page, name: string) {
  page.once('dialog', d => d.accept());
  await page.locator(`tr[data-name="${name}"] .delete-btn`).click();
  await expect(page.locator(`tr[data-name="${name}"]`)).toBeHidden();
}

async function _editFile(page: Page, name: string, newContent: string) {
  await page.locator(`tr[data-name="${name}"] .edit-btn`).click();
  await expect(page.locator('#editor-content')).toBeVisible();
  await page.fill('#editor-content', newContent);
  await page.click('#save-btn');
  await expect(page.locator('#editor-content')).toBeHidden();
}

async function _moveFile(page: Page, name: string, newName: string) {
  await page.locator(`tr[data-name="${name}"] .move-btn`).click();
  await expect(page.locator('#move-dialog')).toBeVisible();
  await page.fill('#move-new-name', newName);
  await page.click('#move-confirm');
  await expect(page.locator(`tr[data-name="${newName}"]`)).toBeVisible();
}

async function _getFileList(page: Page): Promise<string[]> {
  const rows = page.locator('#file-list tr[data-name]');
  const count = await rows.count();
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const n = await rows.nth(i).getAttribute('data-name');
    if (n) names.push(n);
  }
  return names;
}

async function _seeFile(page: Page, name: string) {
  await expect(page.locator(`tr[data-name="${name}"][data-type="file"]`)).toBeVisible();
}

async function _seeFolder(page: Page, name: string) {
  await expect(page.locator(`tr[data-name="${name}"][data-type="folder"]`)).toBeVisible();
}

type FileExplorerFixtures = {
  createFile: (name: string, content?: string) => Promise<void>;
  createFolder: (name: string) => Promise<void>;
  deleteFile: (name: string) => Promise<void>;
  editFile: (name: string, newContent: string) => Promise<void>;
  moveFile: (name: string, newName: string) => Promise<void>;
  getFileList: () => Promise<string[]>;
  seeFile: (name: string) => Promise<void>;
  seeFolder: (name: string) => Promise<void>;
};

const test = base.extend<FileExplorerFixtures>({
  createFile: async ({ page }, use) => {
    await use((name, content?) => _createFile(page, name, content));
  },
  createFolder: async ({ page }, use) => {
    await use((name) => _createFolder(page, name));
  },
  deleteFile: async ({ page }, use) => {
    await use((name) => _deleteFile(page, name));
  },
  editFile: async ({ page }, use) => {
    await use((name, newContent) => _editFile(page, name, newContent));
  },
  moveFile: async ({ page }, use) => {
    await use((name, newName) => _moveFile(page, name, newName));
  },
  getFileList: async ({ page }, use) => {
    await use(() => _getFileList(page));
  },
  seeFile: async ({ page }, use) => {
    await use((name) => _seeFile(page, name));
  },
  seeFolder: async ({ page }, use) => {
    await use((name) => _seeFolder(page, name));
  },
});

export {
  test,
  expect,
  _createFile,
  _createFolder,
  _deleteFile,
  _editFile,
  _moveFile,
  _getFileList,
  _seeFile,
  _seeFolder,
};
