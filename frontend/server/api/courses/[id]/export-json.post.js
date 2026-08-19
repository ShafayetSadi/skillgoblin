import { defineEventHandler, createError, setResponseHeader } from 'h3';
import { getDb } from '../../../utils/db.js';
import { buildCourseJsonPayload } from '../../../utils/courseJsonOverride.js';
import { requireAdmin } from '../../../utils/authz.js';

export default defineEventHandler((event) => {
  requireAdmin(event);
  const row = getDb().prepare(`
    SELECT c.title, c.description, c.category, c.release_date
    FROM courses c JOIN content_roots r ON r.id=c.content_root_id
    WHERE c.id=? AND c.is_available=1 AND r.is_configured=1 AND r.is_available=1
  `).get(event.context.params.id);
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Course not found' });
  setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8');
  setResponseHeader(event, 'Content-Disposition', 'attachment; filename="course.json"');
  return JSON.stringify(buildCourseJsonPayload(row), null, 2) + '\n';
});
