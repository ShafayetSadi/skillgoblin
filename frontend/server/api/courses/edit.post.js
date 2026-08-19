import busboy from 'busboy';
import { getDb } from '../../utils/db.js';
import { processThumbnailBuffer } from '../../utils/thumbnailUtils.js';
import { requireAdmin } from '../../utils/authz.js';

export default defineEventHandler(async (event) => {
  requireAdmin(event);
  const db = getDb();
  try {
    const { fields, files } = await new Promise((resolve, reject) => {
      const parser = busboy({ headers: event.node.req.headers, limits: { fileSize: 10 * 1024 * 1024 } });
      const form = { fields: {}, files: {} };
      parser.on('file', (name, file, info) => {
        const chunks = [];
        file.on('data', chunk => chunks.push(chunk));
        file.on('end', () => { form.files[name] = { buffer: Buffer.concat(chunks), info }; });
      });
      parser.on('field', (name, value) => { form.fields[name] = value; });
      parser.on('close', () => resolve(form));
      parser.on('error', reject);
      event.node.req.pipe(parser);
    });
    const submitted = JSON.parse(fields.course);
    if (!submitted.id || !submitted.title) return { success: false, message: 'Course ID and title are required' };
    const existing = db.prepare(`
      SELECT c.data, c.thumbnail_data FROM courses c JOIN content_roots r ON r.id=c.content_root_id
      WHERE c.id=? AND c.is_available=1 AND r.is_configured=1 AND r.is_available=1
    `).get(submitted.id);
    if (!existing) return { success: false, message: 'Course not found' };
    let thumbnail = existing.thumbnail_data;
    if (files.thumbnail?.buffer) thumbnail = await processThumbnailBuffer(files.thumbnail.buffer);
    const data = {
      ...JSON.parse(existing.data), id: submitted.id, title: submitted.title,
      description: submitted.description, category: submitted.category,
      releaseDate: submitted.releaseDate, thumbnail: 'thumbnail.png', lastUpdate: Date.now()
    };
    db.prepare(`
      UPDATE courses SET title=?, description=?, thumbnail='thumbnail.png', thumbnail_data=?,
        category=?, release_date=?, data=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).run(data.title, data.description, thumbnail, data.category, data.releaseDate, JSON.stringify(data), data.id);
    return { success: true, message: 'Course saved successfully', course: data, databaseUpdated: true };
  } catch (error) {
    console.error('Error saving course:', error);
    return { success: false, message: error.message || 'Failed to save course' };
  }
});
