import { defineEventHandler, getMethod, createError } from 'h3';
import { getDb } from '../../utils/db.js';
import { requireAuth } from '../../utils/authz.js';

export default defineEventHandler((event) => {
  requireAuth(event);
  if (getMethod(event) !== 'GET') throw createError({ statusCode: 405, statusMessage: 'Method not allowed' });
  const row = getDb().prepare(`
    SELECT c.data FROM courses c JOIN content_roots r ON r.id=c.content_root_id
    WHERE c.id=? AND c.is_available=1 AND r.is_configured=1 AND r.is_available=1
  `).get(event.context.params.id);
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Course not found' });
  return JSON.parse(row.data);
});
