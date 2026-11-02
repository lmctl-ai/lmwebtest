import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.post('/api/reset');
});

test('creating a file with path traversal should fail', async ({ request }) => {
  const res = await request.post('/api/files', {
    data: { name: '../escape.txt', type: 'file', content: 'evil' },
  });
  expect(res.status()).toBe(400);
});

test('editing a file with path traversal should fail', async ({ request }) => {
  const res = await request.put('/api/files/%2e%2e/package.json', {
    data: { content: 'hacked' },
  });
  expect([400, 404]).toContain(res.status());
});

test('moving a file with path traversal should fail', async ({ request }) => {
  const res = await request.post('/api/files/hello.txt/move', {
    data: { newName: '../moved.txt' },
  });
  expect(res.status()).toBe(400);
});
