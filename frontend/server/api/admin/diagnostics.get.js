import { defineEventHandler, getQuery, createError } from 'h3';
import { requireAdmin } from '../../utils/authz.js';
import { getDb } from '../../utils/db.js';
import { resolveCourseById } from '../../utils/courseHelpers.js';
import { initialScanStatus } from '../../utils/courseWatcher.js';
import { getScanErrors } from '../../utils/scanDiagnostics.js';
import { diagnoseCourse } from '../../utils/mediaDiagnostics.js';

const VISIBLE = 'c.available=1 AND r.is_configured=1 AND r.is_available=1';

function describeContentRoots(db) {
  return db.prepare('SELECT id, configured_path, is_configured, is_available FROM content_roots ORDER BY is_configured DESC, position').all()
    .map(root => `${root.id}=${root.configured_path} (${!root.is_configured ? 'not configured' : root.is_available ? 'available' : 'unavailable'})`)
    .join(', ');
}

let probing = false;
export default defineEventHandler(async event => {
  requireAdmin(event);
  const db = getDb();
  const query = getQuery(event);
  if (query.courseId) {
    if (probing) throw createError({ statusCode: 429, statusMessage: 'Another media probe is running. Try again shortly.' });
    const course = db.prepare('SELECT id, data FROM courses WHERE id = ?').get(String(query.courseId));
    if (!course) throw createError({ statusCode: 404, statusMessage: 'Course not found' });
    let location;
    try { location = resolveCourseById(db, course.id, { requireAvailable: false }); }
    catch (error) {
      const message = error.statusCode === 503 ? 'Content root is unavailable. Check the content mount.'
        : error.statusCode === 404 ? 'Course directory is missing. Check the content mount.'
        : 'Indexed course folder is invalid.';
      return { courseId: course.id, error: message };
    }
    probing = true;
    try { return await diagnoseCourse({ ...location, ...course }, Math.max(0, parseInt(query.videoIndex) || 0)); }
    finally { probing = false; }
  }
  return {
    configuration: { contentRoots: describeContentRoots(db), databasePath: db.name, watcherIntervalMs: parseInt(process.env.CHOKIDAR_POLLING_INTERVAL || '60000', 10), mediaProbeTimeoutMs: 10000 },
    scan: { ...initialScanStatus }, errors: getScanErrors(),
    counts: db.prepare(`SELECT count(*) AS total, coalesce(sum(NOT (${VISIBLE})), 0) AS unavailable FROM courses c JOIN content_roots r ON r.id=c.content_root_id`).get(),
    courses: db.prepare(`SELECT c.id, c.title, (${VISIBLE}) AS available, c.video_count AS videoCount FROM courses c JOIN content_roots r ON r.id=c.content_root_id ORDER BY available ASC, c.title LIMIT 100`).all()
  };
});
