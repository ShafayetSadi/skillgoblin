import { createError, defineEventHandler } from 'h3';
import { getDb } from '../../utils/db.js';
import { parseCourseMultipart } from '../../utils/courseMultipart.js';
import { processThumbnailBuffer } from '../../utils/thumbnailUtils.js';
import { requireAdmin } from '../../utils/authz.js';

// Content roots are read-only: edits and uploaded thumbnails live in the
// database only. Use the course.json export to persist metadata on disk.
export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const db = getDb();
  try {
    const { fields, files } = await parseCourseMultipart(event.node.req);
    const submitted = JSON.parse(fields.course);
    if (files.thumbnail?.truncated) {
      throw createError({ statusCode: 413, statusMessage: 'Thumbnail exceeds the 10MB upload limit' });
    }
    if (!submitted.id || !submitted.title) return { success: false, message: 'Course ID and title are required' };

    let thumbnailBuffer = null;
    if (files.thumbnail?.buffer) {
      try {
        thumbnailBuffer = await processThumbnailBuffer(files.thumbnail.buffer);
      } catch (error) {
        console.error('Error processing thumbnail:', error);
        throw createError({ statusCode: 422, statusMessage: 'Thumbnail is not a valid image' });
      }
    }

    // Re-read after image processing so indexing and concurrent edits survive.
    const existing = db.prepare(`
      SELECT c.data, c.thumbnail_data FROM courses c JOIN content_roots r ON r.id=c.content_root_id
      WHERE c.id=? AND c.available=1 AND r.is_configured=1 AND r.is_available=1
    `).get(submitted.id);
    if (!existing) throw createError({ statusCode: 404, statusMessage: 'Course no longer exists. Refresh the library before editing.' });
    const data = {
      ...JSON.parse(existing.data), id: submitted.id, title: submitted.title,
      description: submitted.description, category: submitted.category,
      releaseDate: submitted.releaseDate, thumbnail: 'thumbnail.png', lastUpdate: Date.now()
    };
    db.prepare(`
      UPDATE courses SET title=?, description=?, thumbnail='thumbnail.png', thumbnail_data=?,
        category=?, release_date=?, data=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).run(data.title, data.description, thumbnailBuffer ?? existing.thumbnail_data, data.category, data.releaseDate, JSON.stringify(data), data.id);
    return { success: true, message: 'Course saved successfully', course: data, databaseUpdated: true };
  } catch (error) {
    console.error('Error saving course:', error);
    if (error?.statusCode) throw error;
    return { success: false, message: error.message || 'Failed to save course' };
  }
});
