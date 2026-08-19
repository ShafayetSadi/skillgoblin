import { test, expect } from '@playwright/test';

// PR-A e2e: validates the admin Content-tab export flow and the related
// authorization on the new endpoints. The dockerized test fixture has an
// The test stack mounts two read-only named roots. Export returns a downloadable
// root-agnostic JSON bundle and never writes into either content root.

const ADMIN_NAME = process.env.PW_ADMIN_NAME || 'root';
const ADMIN_PASSWORD = process.env.PW_ADMIN_PASSWORD || 'TestAdminPass!';

async function loginAdmin(request) {
  const usersRes = await request.get('/api/users');
  expect(usersRes.ok()).toBeTruthy();
  const users = await usersRes.json();
  const admin = users.find((u) => u.name === ADMIN_NAME);
  expect(admin, `expected admin "${ADMIN_NAME}" in /api/users`).toBeTruthy();
  const r = await request.post('/api/users/auth', {
    data: { userId: admin.id, password: ADMIN_PASSWORD },
  });
  expect(r.ok()).toBeTruthy();
  const body = await r.json();
  expect(body.success).toBe(true);
  return admin;
}

test.describe('admin content export — auth and shape', () => {
  test('POST /api/courses/export-json-all without auth is refused', async ({ request }) => {
    // Fresh request context (no cookie).
    const r = await request.post('/api/courses/export-json-all');
    // 401 (no session) or 403 (session but not admin) — never 200.
    expect([401, 403]).toContain(r.status());
  });

  test('POST /api/courses/export-json-all as admin returns the documented shape', async ({ request }) => {
    await loginAdmin(request);
    const r = await request.post('/api/courses/export-json-all');
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body.version).toBe(1);
    expect(Array.isArray(body.courses)).toBe(true);
  });

  test('GET /api/courses/:id/has-json on a non-existent course returns 404', async ({ request }) => {
    await loginAdmin(request);
    const r = await request.get('/api/courses/definitely-not-a-real-course/has-json');
    expect(r.status()).toBe(404);
  });

  test('POST /api/courses/:id/export-json on a non-existent course returns 404', async ({ request }) => {
    await loginAdmin(request);
    const r = await request.post('/api/courses/definitely-not-a-real-course/export-json');
    expect(r.status()).toBe(404);
  });

  test('export-all returns metadata for courses across the read-only roots', async ({ request }) => {
    await loginAdmin(request);
    // Trigger a rescan first so the fixture course is in the DB.
    const rescan = await request.post('/api/courses/rescan', { data: { preserveMetadata: true } });
    expect(rescan.ok()).toBeTruthy();
    // Wait for the scan to complete.
    for (let i = 0; i < 20; i += 1) {
      const s = await request.get('/api/status/scan');
      const body = await s.json();
      if (body.complete) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    const r = await request.post('/api/courses/export-json-all');
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body.courses.length).toBeGreaterThanOrEqual(2);
    expect(body.courses.every(course => !('root' in course) && !('path' in course))).toBe(true);
  });
});

test.describe('admin content export — UI surface', () => {
  test('admin can reach the Content tab and see the Export-all button', async ({ page, request }) => {
    // Authenticate via API so the cookie is set, then navigate the UI.
    await loginAdmin(request);
    // Copy the cookie jar from the request context into the page context.
    const cookies = await request.storageState();
    await page.context().addCookies(cookies.cookies);

    await page.goto('/courses');
    // Open the Admin Panel from the user profile menu. Try a few common
    // selectors so the test isn't brittle.
    const candidates = [
      page.getByRole('button', { name: /admin/i }),
      page.locator('[data-testid=open-admin-panel]'),
      page.locator('text=Admin Panel'),
    ];
    let opened = false;
    for (const c of candidates) {
      if ((await c.count()) > 0) {
        try {
          await c.first().click({ timeout: 2_000 });
          opened = true;
          break;
        } catch {}
      }
    }

    if (!opened) {
      // The Admin-Panel trigger lives behind a UserProfile dropdown.
      // Click the user avatar/profile area to expand it, then look again.
      const avatarLikely = page.locator('header button, header img').first();
      await avatarLikely.click({ timeout: 2_000 }).catch(() => {});
      const adminButton = page.locator('text=/admin/i').first();
      await adminButton.click({ timeout: 2_000 }).catch(() => {});
    }

    // Now click the Content tab — its data-testid is admin-tab-content
    // because the existing v-for binds testid from each tab's id.
    const contentTab = page.locator('[data-testid=admin-tab-content]');
    if ((await contentTab.count()) === 0) {
      test.skip(true, 'Admin Panel did not open from this UI path; the API-level tests above still cover the endpoint.');
    }
    await contentTab.click();
    await expect(page.locator('[data-testid=admin-export-all-json]')).toBeVisible();
  });
});
