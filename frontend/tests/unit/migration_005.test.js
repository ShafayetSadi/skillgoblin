import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import migration from '../../server/migrations/005_content_roots.js';
import { deriveCourseId } from '../../server/utils/courseIdentity.js';

let db;
let root;
const original = process.env.CONTENT_DIRS;
afterEach(() => {
  db?.close();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  process.env.CONTENT_DIRS = original;
});

function legacyDb(folder='Docker') {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-m005-'));
  fs.mkdirSync(path.join(root, folder));
  process.env.CONTENT_DIRS = `main=${root}`;
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE courses (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
      folder_name TEXT NOT NULL, thumbnail TEXT, thumbnail_data BLOB, category TEXT,
      release_date TEXT, data TEXT NOT NULL, created_at TEXT, updated_at TEXT);
    CREATE TABLE user_progress (id INTEGER PRIMARY KEY, user_id TEXT, progress TEXT);
  `);
  db.prepare('INSERT INTO courses VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    'docker', 'Docker', 'desc', folder, 'thumbnail.png', Buffer.from('thumb'),
    'Dev', '2026-01-01', JSON.stringify({ id: 'docker', title: 'Docker' }),
    '2025-01-01', '2025-02-01'
  );
  db.prepare('INSERT INTO user_progress VALUES (1,?,?)').run('u1', JSON.stringify({ docker: { favorite: true } }));
  return db;
}

describe('005_content_roots migration', () => {
  it('maps legacy courses and progress to root-scoped IDs without losing data', () => {
    const testDb = legacyDb();
    testDb.transaction(() => migration.up(testDb))();
    const id = deriveCourseId('main', 'Docker');
    const row = testDb.prepare('SELECT id, content_root_id, relative_path, thumbnail_data FROM courses').get();
    expect({ ...row, thumbnail_data: row.thumbnail_data.toString() }).toEqual({ id, content_root_id: 'main', relative_path: 'Docker', thumbnail_data: 'thumb' });
    expect(JSON.parse(testDb.prepare('SELECT progress FROM user_progress').get().progress)).toEqual({ [id]: { favorite: true } });
  });
  it('rolls back rather than guessing when a legacy folder is missing', () => {
    const testDb = legacyDb();
    fs.rmSync(path.join(root, 'Docker'), { recursive: true });
    expect(() => testDb.transaction(() => migration.up(testDb))()).toThrow(/not found/);
    expect(testDb.prepare("SELECT name FROM pragma_table_info('courses')").all().map(r => r.name)).toContain('folder_name');
  });
});
