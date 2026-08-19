import { getDb } from './db';

export const saveCourseToDb = (courseData, location, dbInstance = null) => {
  try {
    const db = dbInstance || getDb();
    const { rootId, relativePath } = location;
    const existingLocation = db.prepare(`
      SELECT id FROM courses WHERE content_root_id=? AND relative_path=?
    `).get(rootId, relativePath);
    if (existingLocation && existingLocation.id !== courseData.id) {
      return { error: 'Course location is already assigned to another identity' };
    }
    const existingId = db.prepare('SELECT content_root_id, relative_path FROM courses WHERE id=?').get(courseData.id);
    if (existingId && (existingId.content_root_id !== rootId || existingId.relative_path !== relativePath)) {
      return { error: 'Course identity is already assigned to another location' };
    }

    db.prepare(`
      INSERT INTO courses (
        id, content_root_id, relative_path, title, description, thumbnail,
        thumbnail_data, category, release_date, data, is_available,
        created_at, updated_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        content_root_id=excluded.content_root_id, relative_path=excluded.relative_path,
        title=excluded.title, description=excluded.description, thumbnail=excluded.thumbnail,
        category=excluded.category, release_date=excluded.release_date, data=excluded.data,
        is_available=1, updated_at=CURRENT_TIMESTAMP, last_seen_at=CURRENT_TIMESTAMP
    `).run(
      courseData.id, rootId, relativePath, courseData.title, courseData.description,
      courseData.thumbnail, courseData.category, courseData.releaseDate, JSON.stringify(courseData)
    );
    return { success: true };
  } catch (error) {
    console.error('Error saving course to database:', error);
    return { error: 'Failed to save course' };
  }
};

export const getAllCoursesWithMeta = (dbInstance = null, opts = {}) => {
  const db = dbInstance || getDb();
  const sort = opts.sort === 'newest' ? 'c.created_at DESC, c.id ASC' : 'c.title ASC';
  try {
    return db.prepare(`
      SELECT c.data, c.created_at FROM courses c
      JOIN content_roots r ON r.id=c.content_root_id
      WHERE c.is_available=1 AND r.is_configured=1 AND r.is_available=1
      ORDER BY ${sort}
    `).all().map(row => ({ ...JSON.parse(row.data), created_at: row.created_at }));
  } catch (error) {
    console.error('Error retrieving courses with meta:', error);
    return [];
  }
};

export const getCourseFromDb = (courseId) => {
  try {
    const row = getDb().prepare(`
      SELECT c.data FROM courses c JOIN content_roots r ON r.id=c.content_root_id
      WHERE c.id=? AND c.is_available=1 AND r.is_configured=1 AND r.is_available=1
    `).get(courseId);
    return row ? JSON.parse(row.data) : null;
  } catch (error) {
    console.error(`Error retrieving course ${courseId} from database:`, error);
    return null;
  }
};

export const markCourseUnavailable = (rootId, relativePath, dbInstance = null) => {
  const db = dbInstance || getDb();
  return db.prepare(`
    UPDATE courses SET is_available=0, updated_at=CURRENT_TIMESTAMP
    WHERE content_root_id=? AND relative_path=?
  `).run(rootId, relativePath);
};

export const getCoursesWithDirectories = (dbInstance = null) => {
  const db = dbInstance || getDb();
  return db.prepare('SELECT id, content_root_id, relative_path, is_available FROM courses').all();
};

export const getCourseCountFromDb = () => {
  try { return getDb().prepare('SELECT COUNT(*) AS count FROM courses WHERE is_available=1').get().count; }
  catch { return 0; }
};
