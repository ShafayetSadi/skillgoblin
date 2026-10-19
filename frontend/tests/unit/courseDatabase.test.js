import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { saveCourseToDb, markCourseUnavailable } from '../../server/utils/courseDatabase.js';

import availability from '../../server/migrations/007_library_availability.js';
let db;
afterEach(() => db?.close());
function makeDb() {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE content_roots (id TEXT PRIMARY KEY, configured_path TEXT, canonical_path TEXT, position INTEGER, is_configured INTEGER, is_available INTEGER);
    INSERT INTO content_roots VALUES ('a','/a','/a',0,1,1), ('b','/b','/b',1,1,1);
    CREATE TABLE courses (
      id TEXT PRIMARY KEY, content_root_id TEXT NOT NULL, relative_path TEXT NOT NULL,
      title TEXT NOT NULL, description TEXT, thumbnail TEXT, thumbnail_data BLOB,
      category TEXT, release_date TEXT, data TEXT NOT NULL, available INTEGER DEFAULT 1, video_count INTEGER NOT NULL DEFAULT 0, video_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT, UNIQUE(content_root_id, relative_path)
    );
  `);
  availability.up(db);
  return db;
}
const course = (id, title='Docker') => ({ id, title, description: '', thumbnail: 'thumbnail.png', category: 'Test', releaseDate: '', lessons: [] });

describe('root-scoped course persistence', () => {
  it('stores duplicate folder names in different roots independently', () => {
    const testDb = makeDb();
    expect(saveCourseToDb(course('one'), { rootId: 'a', relativePath: 'Docker' }, testDb)).toEqual({ success: true });
    expect(saveCourseToDb(course('two'), { rootId: 'b', relativePath: 'Docker' }, testDb)).toEqual({ success: true });
    expect(testDb.prepare('SELECT COUNT(*) AS count FROM courses').get().count).toBe(2);
  });
  it('reactivates a retained course at the same identity', () => {
    const testDb = makeDb();
    saveCourseToDb(course('one'), { rootId: 'a', relativePath: 'Docker' }, testDb);
    markCourseUnavailable('a', 'Docker', testDb);
    saveCourseToDb(course('one', 'Docker Updated'), { rootId: 'a', relativePath: 'Docker' }, testDb);
    expect(testDb.prepare('SELECT title, available FROM courses WHERE id=?').get('one')).toEqual({ title: 'Docker Updated', available: 1 });
  });
});
