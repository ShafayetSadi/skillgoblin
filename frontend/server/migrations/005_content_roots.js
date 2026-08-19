import fs from 'node:fs';
import path from 'node:path';
import { parseContentRoots } from '../utils/contentRoots.js';
import { deriveCourseId } from '../utils/courseIdentity.js';

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function migrateProgress(db, idMap) {
  if (!tableExists(db, 'user_progress')) return;
  const update = db.prepare('UPDATE user_progress SET progress=? WHERE id=?');
  for (const row of db.prepare('SELECT id, progress FROM user_progress').all()) {
    let progress;
    try { progress = JSON.parse(row.progress || '{}'); }
    catch (error) { throw new Error(`Cannot migrate malformed progress row ${row.id}: ${error.message}`); }
    const migrated = {};
    for (const [courseId, value] of Object.entries(progress)) migrated[idMap.get(courseId) || courseId] = value;
    update.run(JSON.stringify(migrated), row.id);
  }
}

export default {
  name: '005_content_roots',
  up(db) {
    const roots = parseContentRoots();
    db.exec(`
      CREATE TABLE IF NOT EXISTS content_roots (
        id TEXT PRIMARY KEY, configured_path TEXT NOT NULL, canonical_path TEXT NOT NULL,
        position INTEGER NOT NULL, is_configured INTEGER NOT NULL DEFAULT 1,
        is_available INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, last_seen_at TIMESTAMP
      );
    `);
    const insertRoot = db.prepare(`
      INSERT INTO content_roots (id, configured_path, canonical_path, position, is_configured, is_available, last_seen_at)
      VALUES (?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET configured_path=excluded.configured_path,
        canonical_path=excluded.canonical_path, position=excluded.position,
        is_configured=1, is_available=1, updated_at=CURRENT_TIMESTAMP, last_seen_at=CURRENT_TIMESTAMP
    `);
    for (const root of roots) insertRoot.run(root.id, root.configuredPath, root.canonicalPath, root.position);

    const columns = db.prepare("SELECT name FROM pragma_table_info('courses')").all().map(row => row.name);
    if (columns.includes('content_root_id')) return;
    const mapped = db.prepare('SELECT * FROM courses').all().map(row => {
      const matches = roots.filter(root => {
        try { return fs.lstatSync(path.join(root.canonicalPath, row.folder_name)).isDirectory(); }
        catch { return false; }
      });
      if (matches.length !== 1) {
        const reason = matches.length === 0 ? 'was not found in any configured root' : `exists in roots: ${matches.map(r => r.id).join(', ')}`;
        throw new Error(`Cannot migrate legacy course "${row.folder_name}": ${reason}`);
      }
      return { row, root: matches[0], newId: deriveCourseId(matches[0].id, row.folder_name) };
    });

    db.exec(`
      ALTER TABLE courses RENAME TO courses_legacy_005;
      CREATE TABLE courses (
        id TEXT PRIMARY KEY, content_root_id TEXT NOT NULL, relative_path TEXT NOT NULL,
        title TEXT NOT NULL, description TEXT, thumbnail TEXT, thumbnail_data BLOB,
        category TEXT DEFAULT 'Uncategorized', release_date TEXT, data TEXT NOT NULL,
        is_available INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, last_seen_at TIMESTAMP,
        FOREIGN KEY (content_root_id) REFERENCES content_roots(id),
        UNIQUE(content_root_id, relative_path)
      );
    `);
    const insertCourse = db.prepare(`
      INSERT INTO courses (id, content_root_id, relative_path, title, description, thumbnail,
        thumbnail_data, category, release_date, data, is_available, created_at, updated_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP)
    `);
    const idMap = new Map();
    for (const { row, root, newId } of mapped) {
      const data = JSON.parse(row.data);
      data.id = newId;
      insertCourse.run(newId, root.id, row.folder_name, row.title, row.description, row.thumbnail,
        row.thumbnail_data, row.category, row.release_date, JSON.stringify(data), row.created_at, row.updated_at);
      idMap.set(row.id, newId);
    }
    migrateProgress(db, idMap);
    db.exec('DROP TABLE courses_legacy_005');
  }
};
