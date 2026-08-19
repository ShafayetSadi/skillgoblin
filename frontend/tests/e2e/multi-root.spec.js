import { test, expect } from '@playwright/test';

const ADMIN_NAME = process.env.PW_ADMIN_NAME || 'root';
const ADMIN_PASSWORD = process.env.PW_ADMIN_PASSWORD || 'TestAdminPass!';

async function loginAdmin(request) {
  const users = await (await request.get('/api/users')).json();
  const admin = users.find(user => user.name === ADMIN_NAME);
  expect(admin).toBeTruthy();
  const response = await request.post('/api/users/auth', {
    data: { userId: admin.id, password: ADMIN_PASSWORD }
  });
  expect(response.ok()).toBeTruthy();
  return admin;
}

async function waitForScan(request) {
  const started = await request.post('/api/courses/rescan', { data: { preserveMetadata: true } });
  expect(started.ok()).toBeTruthy();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await (await request.get('/api/status/scan')).json();
    if (status.complete) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Multi-root scan did not complete');
}

test.describe('multiple content roots', () => {
  test('same-named courses are distinct and keep independent progress', async ({ request }) => {
    const admin = await loginAdmin(request);
    await waitForScan(request);
    const library = await (await request.get('/api/courses?limit=100')).json();
    const duplicates = library.items.filter(course => course.title === 'Sample Course');
    expect(duplicates).toHaveLength(2);
    expect(new Set(duplicates.map(course => course.id)).size).toBe(2);
    for (const course of duplicates) {
      expect(course).not.toHaveProperty('contentRoot');
      expect(course).not.toHaveProperty('content_root_id');
      expect(course).not.toHaveProperty('relative_path');
    }

    await request.post(`/api/user-progress/${admin.id}`, {
      data: { courseId: duplicates[0].id, data: { completed: { 'lesson-1-0': true }, progress: {}, favorite: false } }
    });
    await request.post(`/api/user-progress/${admin.id}`, {
      data: { courseId: duplicates[1].id, data: { completed: {}, progress: { 'lesson-1-0': 25 }, favorite: true } }
    });
    const progress = await (await request.get(`/api/user-progress/${admin.id}`)).json();
    expect(progress.progress[duplicates[0].id].completed['lesson-1-0']).toBe(true);
    expect(progress.progress[duplicates[1].id].progress['lesson-1-0']).toBe(25);
  });
});
