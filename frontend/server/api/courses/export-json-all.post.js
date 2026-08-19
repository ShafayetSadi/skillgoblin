import { defineEventHandler, setResponseHeader } from 'h3';
import { getDb } from '../../utils/db.js';
import { buildCourseJsonPayload } from '../../utils/courseJsonOverride.js';
import { requireAdmin } from '../../utils/authz.js';

export default defineEventHandler((event) => {
  requireAdmin(event);
  const rows = getDb().prepare(`
    SELECT c.id, c.title, c.description, c.category, c.release_date
    FROM courses c JOIN content_roots r ON r.id=c.content_root_id
    WHERE c.is_available=1 AND r.is_configured=1 AND r.is_available=1
    ORDER BY c.title, c.id
  `).all();
  const payload = { version: 1, courses: rows.map(row => ({ id: row.id, metadata: buildCourseJsonPayload(row) })) };
  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8');
  setResponseHeader(event, 'Content-Disposition', 'attachment; filename="skillgoblin-course-metadata.json"');
  return JSON.stringify(payload, null, 2) + '\n';
});
