import { defineEventHandler } from 'h3';
import { getDb } from '../utils/db';
import { requireAuth } from '../utils/authz.js';
export default defineEventHandler(event => {
  requireAuth(event);
  return getDb().prepare(`
    SELECT DISTINCT c.category FROM courses c JOIN content_roots r ON r.id=c.content_root_id
    WHERE c.available=1 AND r.is_configured=1 AND r.is_available=1
      AND trim(coalesce(c.category, '')) <> ''
    ORDER BY c.category
  `).all().map(row => row.category);
});
