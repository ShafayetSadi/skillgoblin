import { describe, it, expect, afterEach, vi } from 'vitest';
import * as generator from '../../server/utils/courseGenerator.js';
import * as thumbnails from '../../server/utils/thumbnailUtils.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { topLevelCoursePath, scanCoursesOnStartup, initialScanStatus, closeCourseWatchers, setupFileWatcher, synchronizeCourseThumbnail } from '../../server/utils/courseWatcher.js';
import { deriveCourseId } from '../../server/utils/courseIdentity.js';
import { parseContentRoots, synchronizeContentRoots } from '../../server/utils/contentRoots.js';
import { getDb } from '../../server/utils/db.js';

const ROOT = 'watch';
const originalContentDirs = process.env.CONTENT_DIRS;
let tempDir;

function useTempRoot(prefix) {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.CONTENT_DIRS = `${ROOT}=${tempDir}`;
  synchronizeContentRoots(getDb(), parseContentRoots());
  return tempDir;
}

function insertCourse(relativePath, fields = {}) {
  const id = deriveCourseId(ROOT, relativePath);
  const row = { title: relativePath, description: null, category: null, release_date: null, thumbnail_data: null, ...fields };
  getDb().prepare(`
    INSERT INTO courses (id, content_root_id, relative_path, title, description, category, release_date, thumbnail_data, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ROOT, relativePath, row.title, row.description, row.category, row.release_date, row.thumbnail_data,
    JSON.stringify({ id, title: row.title, lessons: [] }));
  return id;
}

const generated = (title) => async (courseDir, coursePath, id) => ({
  id, title, lessons: [], description: '', category: '', releaseDate: '', thumbnail: ''
});

afterEach(() => {
  vi.restoreAllMocks();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  const db = getDb();
  db.prepare('DELETE FROM courses WHERE content_root_id = ?').run(ROOT);
  db.prepare('DELETE FROM content_roots WHERE id = ?').run(ROOT);
  process.env.CONTENT_DIRS = originalContentDirs;
  synchronizeContentRoots(db, parseContentRoots());
});

describe('course watcher routing', () => {
  it('does not overwrite a UI thumbnail uploaded while a cover image is processing', async () => {
    const root = useTempRoot('sg-thumb-cas-');
    const coursePath = path.join(root, 'Metadata Course');
    fs.mkdirSync(coursePath);
    fs.writeFileSync(path.join(coursePath, 'cover.png'), 'local cover');
    const db = getDb();
    const id = insertCourse('Metadata Course', { thumbnail_data: Buffer.from('original') });
    let release;
    vi.spyOn(thumbnails, 'readAndProcessThumbnail').mockReturnValue(new Promise(resolve => { release = resolve; }));
    const pending = synchronizeCourseThumbnail(id, coursePath);
    db.prepare('UPDATE courses SET thumbnail_data = ? WHERE id = ?').run(Buffer.from('new UI upload'), id);
    release(Buffer.from('processed old local cover'));
    await pending;
    expect(db.prepare('SELECT thumbnail_data FROM courses WHERE id = ?').get(id).thumbnail_data.toString()).toBe('new UI upload');
  });

  it('stops a full scan after its current course on shutdown', async () => {
    const root = useTempRoot('sg-scan-stop-');
    fs.mkdirSync(path.join(root, 'Metadata Course'));
    fs.mkdirSync(path.join(root, 'Z Course'));
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const scan = vi.spyOn(generator, 'generateCourseJson').mockImplementation(async (...args) => {
      await gate;
      return generated('Test')(...args);
    });
    const pending = scanCoursesOnStartup(true, true);
    await Promise.resolve();
    const closing = closeCourseWatchers();
    release();
    await closing;
    expect(await pending).toBe(false);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(initialScanStatus.inProgress).toBe(false);
    expect(initialScanStatus.complete).toBe(false);
    // Restore watcher lifecycle for other tests in the shared module pool.
    await setupFileWatcher().close();
  });

  it('coalesces forced scans and preserves metadata edited during generation', async () => {
    const root = useTempRoot('sg-scan-race-');
    fs.mkdirSync(path.join(root, 'Metadata Course'));
    const db = getDb();
    const id = insertCourse('Metadata Course', { title: 'Before' });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const scan = vi.spyOn(generator, 'generateCourseJson').mockImplementation(async (...args) => {
      await gate;
      return generated('Generated')(...args);
    });
    const first = scanCoursesOnStartup(true, true);
    expect(initialScanStatus.inProgress).toBe(true);
    expect(initialScanStatus.complete).toBe(false);
    const second = scanCoursesOnStartup(true, true);
    expect(second).toBe(first);
    await Promise.resolve();
    db.prepare("UPDATE courses SET title = 'Edited during scan' WHERE id = ?").run(id);
    release();
    await first;
    expect(scan).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT title FROM courses WHERE id = ?').get(id).title).toBe('Edited during scan');
  });

  it('maps a nested event to the owning top-level course', () => {
    const root = path.resolve('/content/a');
    expect(topLevelCoursePath(root, path.join(root, 'Docker', 'Lesson 1', 'video.mp4'))).toBe(path.join(root, 'Docker'));
  });

  it('ignores events outside a root', () => {
    expect(topLevelCoursePath('/content/a', '/content/b/Docker/video.mp4')).toBeNull();
  });

  it('gives the same folder name different stable IDs in different roots', () => {
    expect(deriveCourseId('a', 'Docker')).not.toBe(deriveCourseId('b', 'Docker'));
    expect(deriveCourseId('a', 'Docker')).toBe(deriveCourseId('a', 'Docker'));
  });

  it('retains missing courses as unavailable during an empty root scan', async () => {
    useTempRoot('sg-watcher-');
    const id = insertCourse('Missing Course', { title: 'Stale' });

    expect(await scanCoursesOnStartup(false, true)).toBe(true);

    expect(getDb().prepare('SELECT id, available FROM courses WHERE id = ?').get(id)).toEqual({ id, available: 0 });
  });

  it('preserves intentionally blank metadata during a normal rescan', async () => {
    const root = useTempRoot('sg-watcher-empty-metadata-');
    fs.mkdirSync(path.join(root, 'Metadata Course'));
    const id = insertCourse('Metadata Course', { description: '', category: '', release_date: '' });

    expect(await scanCoursesOnStartup(false, true)).toBe(true);

    expect(getDb().prepare(`
      SELECT description, category, release_date FROM courses WHERE id = ?
    `).get(id)).toEqual({ description: '', category: '', release_date: '' });
  });
});
