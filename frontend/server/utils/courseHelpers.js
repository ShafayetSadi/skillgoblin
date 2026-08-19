import fs from 'node:fs';
import path from 'node:path';
import { createError } from 'h3';
import { pathIsWithin } from './contentRoots.js';

export const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi']);

function courseError(statusCode, statusMessage) {
  throw createError({ statusCode, statusMessage });
}

export function resolveCourseById(db, courseId, { requireAvailable = true, notFoundMessage = 'Course not found' } = {}) {
  const row = db.prepare(`
    SELECT c.id, c.content_root_id, c.relative_path, c.title,
           c.is_available AS course_available, r.configured_path, r.canonical_path,
           r.is_configured, r.is_available AS root_available
    FROM courses c JOIN content_roots r ON r.id=c.content_root_id WHERE c.id=?
  `).get(courseId);
  if (!row) courseError(404, notFoundMessage);
  if (!row.is_configured || !row.root_available) courseError(503, 'Content root unavailable');
  if (requireAvailable && !row.course_available) courseError(404, notFoundMessage);

  try {
    const liveRoot = fs.realpathSync.native(row.configured_path);
    fs.accessSync(liveRoot, fs.constants.R_OK | fs.constants.X_OK);
    if (liveRoot !== row.canonical_path) courseError(503, 'Content root changed; rescan required');
  } catch (error) {
    if (error?.statusCode) throw error;
    courseError(503, 'Content root unavailable');
  }

  const courseDir = path.resolve(row.canonical_path, row.relative_path);
  if (!pathIsWithin(row.canonical_path, courseDir) || courseDir === path.resolve(row.canonical_path)) {
    courseError(500, 'Invalid stored course path');
  }
  let canonicalCourseDir;
  try { canonicalCourseDir = fs.realpathSync.native(courseDir); }
  catch (error) {
    if (error.code === 'ENOENT') courseError(404, notFoundMessage);
    throw error;
  }
  if (!pathIsWithin(row.canonical_path, canonicalCourseDir)) courseError(500, 'Invalid stored course path');
  return { ...row, courseDir, canonicalCourseDir };
}

export function resolvePathInCourse(course, ...segments) {
  const root = path.resolve(course.courseDir || course);
  const canonicalRoot = course.canonicalCourseDir || fs.realpathSync.native(root);
  for (const segment of segments) {
    if (typeof segment !== 'string' || segment.includes('\0') || segment.includes('\\') || path.isAbsolute(segment)) courseError(400, 'Invalid path');
  }
  const candidate = path.resolve(root, ...segments);
  if (!pathIsWithin(root, candidate) || candidate === root) courseError(400, 'Invalid path');
  return { candidate, canonicalRoot };
}

export function resolveExistingPathInCourse(course, ...segments) {
  const { candidate, canonicalRoot } = resolvePathInCourse(course, ...segments);
  let canonicalCandidate;
  try { canonicalCandidate = fs.realpathSync.native(candidate); }
  catch (error) {
    if (error.code === 'ENOENT') courseError(404, 'File not found');
    throw error;
  }
  if (!pathIsWithin(canonicalRoot, canonicalCandidate) || canonicalCandidate === canonicalRoot) courseError(400, 'Invalid path');
  return canonicalCandidate;
}

export const naturalSort = (a, b, property = 'title') => {
  const aValue = a[property];
  const bValue = b[property];
  const aMatch = aValue.match(/^(\d+)/);
  const bMatch = bValue.match(/^(\d+)/);
  if (aMatch && bMatch) return parseInt(aMatch[1]) - parseInt(bMatch[1]);
  return aValue.localeCompare(bValue);
};
