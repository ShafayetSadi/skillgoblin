import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import { parseContentRoots, synchronizeContentRoots, findOwningRoot } from './contentRoots.js';
import { deriveCourseId } from './courseIdentity.js';
import { generateCourseJson } from './courseGenerator.js';
import { saveCourseToDb, markCourseUnavailable, getCoursesWithDirectories } from './courseDatabase.js';
import { getDb } from './db.js';
import { readAndProcessThumbnail, findLocalThumbnailPath, extractFrameThumbnail } from './thumbnailUtils.js';
import { readCourseJson, ALLOWED } from './courseJsonOverride.js';

export const initialScanStatus = {
  inProgress: false, complete: false, totalCourses: 0, processedCourses: 0,
  totalRoots: 0, processedRoots: 0, startTime: null, endTime: null,
  error: null, preserveMetadata: true
};

export function topLevelCoursePath(contentDir, changedPath) {
  const root = path.resolve(contentDir);
  const relative = path.relative(root, path.resolve(changedPath));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const first = relative.split(path.sep)[0];
  return first ? path.join(root, first) : null;
}

function jsonPinnedFields(coursePath) {
  const parsed = readCourseJson(coursePath);
  if (!parsed) return new Set();
  return new Set(ALLOWED.filter(key => key in parsed && typeof parsed[key] === 'string'));
}

function firstVideoPath(coursePath, courseData) {
  for (const lesson of courseData.lessons || []) {
    const video = lesson.videos?.[0];
    if (video?.file) return path.join(coursePath, lesson.folder || '', video.file);
  }
  return null;
}

async function synchronizeCourseThumbnail(courseId, coursePath, courseData) {
  const db = getDb();
  const localPath = findLocalThumbnailPath(coursePath);
  const row = db.prepare('SELECT thumbnail_data FROM courses WHERE id=?').get(courseId);
  let localBuffer = null;
  if (localPath) {
    try { localBuffer = fs.readFileSync(localPath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (localBuffer) {
    const processed = await readAndProcessThumbnail(localPath, localBuffer);
    const operatorAuthored = path.basename(localPath) !== 'thumbnail.png';
    if (processed && (!row?.thumbnail_data || (operatorAuthored && !processed.equals(row.thumbnail_data)))) {
      db.prepare('UPDATE courses SET thumbnail_data=? WHERE id=?').run(processed, courseId);
    }
  } else if (!row?.thumbnail_data) {
    const generated = await extractFrameThumbnail(firstVideoPath(coursePath, courseData));
    if (generated) db.prepare('UPDATE courses SET thumbnail_data=? WHERE id=?').run(generated, courseId);
  }
}

async function processCourse(root, relativePath, preserveMetadata = true) {
  const coursePath = path.join(root.canonicalPath, relativePath);
  const courseId = deriveCourseId(root.id, relativePath);
  const generated = await generateCourseJson(path.basename(relativePath), coursePath, courseId);
  const db = getDb();
  const existing = db.prepare(`SELECT title, description, category, release_date FROM courses WHERE id=?`).get(courseId);
  let courseData = generated;
  if (preserveMetadata && existing) {
    const pinned = jsonPinnedFields(coursePath);
    courseData = {
      ...generated,
      title: pinned.has('title') ? generated.title : (existing.title || generated.title),
      description: pinned.has('description') ? generated.description : (existing.description || generated.description),
      category: pinned.has('category') ? generated.category : (existing.category || generated.category),
      releaseDate: pinned.has('releaseDate') ? generated.releaseDate : (existing.release_date || generated.releaseDate)
    };
  }
  const result = saveCourseToDb(courseData, { rootId: root.id, relativePath });
  if (result.error) throw new Error(result.error);
  if (!preserveMetadata) db.prepare('UPDATE courses SET thumbnail_data=NULL WHERE id=?').run(courseId);
  await synchronizeCourseThumbnail(courseId, coursePath, courseData);
  return courseId;
}

function discoverRoot(root) {
  return fs.readdirSync(root.canonicalPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'))
    .map(entry => entry.name);
}

export const scanCoursesOnStartup = async (forceRescan = false, preserveMetadata = true) => {
  if (initialScanStatus.inProgress && !forceRescan) return false;
  initialScanStatus.inProgress = true;
  initialScanStatus.complete = false;
  initialScanStatus.startTime = Date.now();
  initialScanStatus.processedCourses = 0;
  initialScanStatus.processedRoots = 0;
  initialScanStatus.error = null;
  initialScanStatus.preserveMetadata = preserveMetadata;
  try {
    const roots = parseContentRoots();
    const db = getDb();
    synchronizeContentRoots(db, roots);
    const discovered = roots.map(root => ({ root, courses: discoverRoot(root) }));
    initialScanStatus.totalRoots = roots.length;
    initialScanStatus.totalCourses = discovered.reduce((sum, item) => sum + item.courses.length, 0);
    const seen = new Set();
    for (const { root, courses } of discovered) {
      for (const relativePath of courses) {
        await processCourse(root, relativePath, preserveMetadata);
        seen.add(`${root.id}\0${relativePath}`);
        initialScanStatus.processedCourses += 1;
      }
      initialScanStatus.processedRoots += 1;
    }
    for (const course of getCoursesWithDirectories(db)) {
      if (!seen.has(`${course.content_root_id}\0${course.relative_path}`)) {
        markCourseUnavailable(course.content_root_id, course.relative_path, db);
      }
    }
    initialScanStatus.complete = true;
    initialScanStatus.endTime = Date.now();
    return true;
  } catch (error) {
    console.error('Error during course scan:', error);
    initialScanStatus.error = error.message || 'Unknown error during scan';
    initialScanStatus.complete = false;
    return false;
  } finally {
    initialScanStatus.inProgress = false;
  }
};

const DEBOUNCE_MS = 2000;
const pending = new Map();

export const setupFileWatcher = (pollingInterval = 60000) => {
  try {
    const roots = parseContentRoots();
    const watcher = chokidar.watch(roots.map(root => root.canonicalPath), {
      ignored: /(^|[\/\\])\../, persistent: true, ignoreInitial: true,
      followSymlinks: false, usePolling: true, interval: pollingInterval
    });
    const schedule = (changedPath) => {
      const root = findOwningRoot(roots, changedPath);
      if (!root) return;
      const coursePath = topLevelCoursePath(root.canonicalPath, changedPath);
      if (!coursePath) return;
      const relativePath = path.relative(root.canonicalPath, coursePath);
      const key = `${root.id}\0${relativePath}`;
      clearTimeout(pending.get(key));
      pending.set(key, setTimeout(async () => {
        pending.delete(key);
        try {
          fs.accessSync(root.canonicalPath, fs.constants.R_OK | fs.constants.X_OK);
        } catch {
          getDb().prepare('UPDATE content_roots SET is_available=0, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(root.id);
          return;
        }
        getDb().prepare(`
          UPDATE content_roots SET is_available=1, last_seen_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP WHERE id=? AND is_configured=1
        `).run(root.id);
        try {
          if (fs.lstatSync(coursePath).isDirectory()) await processCourse(root, relativePath, true);
          else markCourseUnavailable(root.id, relativePath);
        } catch (error) {
          if (error.code === 'ENOENT') markCourseUnavailable(root.id, relativePath);
          else console.error(`Error processing course ${key}:`, error);
        }
      }, DEBOUNCE_MS));
    };
    for (const eventName of ['add', 'change', 'unlink', 'addDir', 'unlinkDir']) watcher.on(eventName, schedule);
    watcher.on('error', error => console.error('Course watcher error:', error));
    return watcher;
  } catch (error) {
    console.error('Error setting up course watcher:', error);
    return null;
  }
};
