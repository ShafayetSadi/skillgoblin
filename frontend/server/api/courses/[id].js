import { defineEventHandler, getMethod, createError } from 'h3';
import { getDb } from '../../utils/db.js';
import { requireAuth } from '../../utils/authz.js';

export default defineEventHandler((event) => {
  requireAuth(event);
  if (getMethod(event) !== 'GET') throw createError({ statusCode: 405, statusMessage: 'Method not allowed' });
  const course = getDb().prepare(`
    SELECT c.data, c.available, r.is_configured, r.is_available AS root_available
    FROM courses c JOIN content_roots r ON r.id=c.content_root_id WHERE c.id=?
  `).get(event.context.params.id);
  if (!course) throw createError({ statusCode: 404, statusMessage: 'Course not found. Rescan the library if it was recently added.' });
  if (!course.available || !course.is_configured || !course.root_available) {
    throw createError({ statusCode: 404, statusMessage: 'Course is unavailable. Its saved progress is retained.' });
  }
  return JSON.parse(course.data);
});
