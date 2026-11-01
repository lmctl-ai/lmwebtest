import { test, expect } from './helpers';

test.beforeEach(async ({ page, request }) => {
  await request.post('/api/reset');
  await page.goto('/');
  await expect(page.locator('#file-table')).toBeVisible();
});

test('list pre-seeded files', async ({ getFileList, seeFile, seeFolder }) => {
  await seeFolder('documents');
  await seeFolder('projects');
  await seeFile('hello.txt');
  await seeFile('notes.txt');
  await seeFile('documents/report.txt');
  await seeFile('documents/memo.txt');
  await seeFile('projects/alpha.txt');

  const files = await getFileList();
  expect(files).toContain('hello.txt');
  expect(files).toContain('documents/report.txt');
});

test('create a new file', async ({ createFile, seeFile, getFileList }) => {
  await createFile('new-file.txt', 'Hello from test');
  await seeFile('new-file.txt');

  const files = await getFileList();
  expect(files).toContain('new-file.txt');
});

test('create a folder', async ({ createFolder, seeFolder, getFileList }) => {
  await createFolder('new-folder');
  await seeFolder('new-folder');

  const files = await getFileList();
  expect(files).toContain('new-folder');
});

test('edit file content', async ({ editFile, page }) => {
  await editFile('hello.txt', 'Updated content here');
  await page.locator('tr[data-name="hello.txt"] .edit-btn').click();
  await expect(page.locator('#editor-content')).toHaveValue('Updated content here');
});

test('delete a file', async ({ deleteFile, seeFile }) => {
  await deleteFile('hello.txt');
  await expect(seeFile('hello.txt')).rejects.toThrow();
});

test('move/rename a file', async ({ moveFile, seeFile, getFileList }) => {
  await moveFile('hello.txt', 'greeting.txt');
  await seeFile('greeting.txt');

  const files = await getFileList();
  expect(files).toContain('greeting.txt');
  expect(files).not.toContain('hello.txt');
});
