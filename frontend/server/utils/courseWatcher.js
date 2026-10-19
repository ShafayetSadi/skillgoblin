import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import { recordScanError } from './scanDiagnostics.js';
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

// Content roots are read-only inputs: the DB blob is the only thumbnail we
// write. Updates compare-and-swap on the blob read at entry so a UI upload
// made while a cover image is being processed is never overwritten.
export async function synchronizeCourseThumbnail(courseId, coursePath, courseData = null) {
  try {
    const db = getDb();
    const localPath = findLocalThumbnailPath(coursePath);
    const current = db.prepare('SELECT thumbnail_data FROM courses WHERE id=?').get(courseId)?.thumbnail_data ?? null;
    let localBuffer = null;
    if (localPath) {
      try { localBuffer = fs.readFileSync(localPath); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (localBuffer) {
      // Only operator-dropped cover art (cover.jpg, poster.png, ...) displaces
      // an existing blob; a thumbnail.png keeps edit-process-wins semantics.
      const operatorAuthored = path.basename(localPath) !== 'thumbnail.png';
      if (current && !operatorAuthored) return;
      const processed = await readAndProcessThumbnail(localPath, localBuffer);
      if (processed && (!current || !processed.equals(current))) {
        db.prepare('UPDATE courses SET thumbnail_data=? WHERE id=? AND thumbnail_data IS ?').run(processed, courseId, current);
      }
    } else if (!current) {
      const videoPath = courseData && firstVideoPath(coursePath, courseData);
      const generated = videoPath ? await extractFrameThumbnail(videoPath) : null;
      if (generated) db.prepare('UPDATE courses SET thumbnail_data=? WHERE id=? AND thumbnail_data IS NULL').run(generated, courseId);
    }
  } catch (error) {
    recordScanError(coursePath, error);
    console.error(`Error synchronizing thumbnail for course ${courseId} (${coursePath}):`, error);
  }
}

async function processCourse(root, relativePath, preserveMetadata = true) {
  const coursePath = path.join(root.canonicalPath, relativePath);
  const courseId = deriveCourseId(root.id, relativePath);
  const generated = await generateCourseJson(path.basename(relativePath), coursePath, courseId);
  if (!fs.statSync(coursePath).isDirectory()) throw new Error('Course path is not a directory');
  const db = getDb();
  // Read after directory traversal: admin edits made during the await must survive.
  const existing = db.prepare(`SELECT title, description, category, release_date FROM courses WHERE id=?`).get(courseId);
  let courseData = generated;
  if (preserveMetadata && existing) {
    const pinned = jsonPinnedFields(coursePath);
    courseData = {
      ...generated,
      title: pinned.has('title') ? generated.title : (existing.title ?? generated.title),
      description: pinned.has('description') ? generated.description : (existing.description ?? generated.description),
      category: pinned.has('category') ? generated.category : (existing.category ?? generated.category),
      releaseDate: pinned.has('releaseDate') ? generated.releaseDate : (existing.release_date ?? generated.releaseDate)
    };
  }
  const result = saveCourseToDb(courseData, { rootId: root.id, relativePath });
  if (result.error) throw new Error(result.error);
  if (!preserveMetadata) db.prepare('UPDATE courses SET thumbnail_data=NULL WHERE id=?').run(courseId);
  await synchronizeCourseThumbnail(courseId, coursePath, courseData);
  return courseId;
}

// Missing folders are recoverable: hide the course but never delete its
// metadata or progress.
function handleCourseError(root, relativePath, error) {
  const coursePath = path.join(root.canonicalPath, relativePath);
  if (error.code === 'ENOENT' && !fs.existsSync(coursePath)) markCourseUnavailable(root.id, relativePath);
  recordScanError(`${root.id}:${relativePath}`, error);
  console.error(`Error processing course ${root.id}:${relativePath}:`, error);
}

function discoverRoot(root) {
  return fs.readdirSync(root.canonicalPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'))
    .map(entry => entry.name);
}

const runFullScan = async (preserveMetadata = true) => {
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
        if (stopping) return false;
        seen.add(`${root.id}\0${relativePath}`);
        try {
          await processCourse(root, relativePath, preserveMetadata);
        } catch (error) {
          handleCourseError(root, relativePath, error);
        }
        initialScanStatus.processedCourses += 1;
      }
      initialScanStatus.processedRoots += 1;
    }
    if (stopping) return false;
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
    recordScanError('(library)', error);
    initialScanStatus.error = error.message || 'Unknown error during scan';
    initialScanStatus.complete = false;
    return false;
  }
};

const DEBOUNCE_MS = 2000;
let queue = Promise.resolve();
let fullScan = null;
let stopping = false;
const pendingTimers = new Map();
const pendingCourses = new Set();
const watchers = new Set();

function enqueue(work) {
  const result = queue.then(() => stopping ? undefined : work());
  queue = result.catch(error => recordScanError('(queue)', error));
  return result;
}

// Scans and watcher events share one queue; concurrent scan requests
// coalesce onto the scan already queued or running.
export const scanCoursesOnStartup = (forceRescan = false, preserveMetadata = true) => {
  if (fullScan) return fullScan;
  if (stopping) return Promise.resolve(false);
  initialScanStatus.inProgress = true;
  initialScanStatus.complete = false;
  initialScanStatus.error = null;
  fullScan = enqueue(() => runFullScan(preserveMetadata))
    .then(result => result ?? false)
    .finally(() => { fullScan = null; initialScanStatus.inProgress = false; });
  return fullScan;
};

export const setupFileWatcher = (pollingInterval = 60000) => {
  stopping = false;
  try {
    const roots = parseContentRoots();
    const watcher = chokidar.watch(roots.map(root => root.canonicalPath), {
      ignored: /(^|[/\\])\../, persistent: true, ignoreInitial: true,
      followSymlinks: false, usePolling: true, interval: pollingInterval
    });
    watchers.add(watcher);
    const processChange = async (root, relativePath, coursePath) => {
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
        handleCourseError(root, relativePath, error);
      }
    };
    const schedule = (changedPath) => {
      if (stopping) return;
      const root = findOwningRoot(roots, changedPath);
      if (!root) return;
      const coursePath = topLevelCoursePath(root.canonicalPath, changedPath);
      if (!coursePath) return;
      const relativePath = path.relative(root.canonicalPath, coursePath);
      const key = `${root.id}\0${relativePath}`;
      clearTimeout(pendingTimers.get(key));
      pendingTimers.set(key, setTimeout(() => {
        pendingTimers.delete(key);
        if (pendingCourses.has(key)) return;
        pendingCourses.add(key);
        enqueue(async () => {
          // Remove before processing so a change during the await queues another pass.
          pendingCourses.delete(key);
          await processChange(root, relativePath, coursePath);
        });
      }, DEBOUNCE_MS));
    };
    for (const eventName of ['add', 'change', 'unlink', 'addDir', 'unlinkDir']) watcher.on(eventName, schedule);
    watcher.on('error', error => recordScanError('(watcher)', error));
    return watcher;
  } catch (error) {
    recordScanError('(watcher)', error);
    console.error('Error setting up course watcher:', error);
    return null;
  }
};

export async function closeCourseWatchers() {
  stopping = true;
  for (const timer of pendingTimers.values()) clearTimeout(timer);
  pendingTimers.clear();
  pendingCourses.clear();
  await Promise.all([...watchers].map(watcher => watcher.close()));
  watchers.clear();
  await queue;
}
