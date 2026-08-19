import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './db.js';
import { resolveCourseById, VIDEO_EXTENSIONS } from './courseHelpers.js';
import { pathIsWithin } from './contentRoots.js';

const SKIPPED_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, '.mov', '.webm', '.flv', '.wmv', '.srt']);
const EXCLUDED_FILES = new Set(['thumbnail.png', 'course.json']);
const SYSTEM_FILES = new Set(['.ds_store', 'thumbs.db']);

function formatSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${parseFloat((bytes / (1024 ** index)).toFixed(2))} ${sizes[index]}`;
}

export async function scanCourseFiles(courseId) {
  const course = resolveCourseById(getDb(), courseId);
  const groups = new Map();
  const visited = new Set();
  async function walk(currentPath, relativeBase = '') {
    const canonical = await fs.promises.realpath(currentPath);
    if (!pathIsWithin(course.canonicalCourseDir, canonical)) throw new Error('Course path escapes its root');
    if (visited.has(canonical)) return;
    visited.add(canonical);
    for (const entry of await fs.promises.readdir(currentPath, { withFileTypes: true })) {
      if (SYSTEM_FILES.has(entry.name.toLowerCase())) continue;
      const fullPath = path.join(currentPath, entry.name);
      const realPath = await fs.promises.realpath(fullPath).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
      if (!realPath || !pathIsWithin(course.canonicalCourseDir, realPath)) continue;
      const stat = await fs.promises.stat(realPath);
      const relativePath = path.posix.join(relativeBase.replaceAll('\\', '/'), entry.name);
      if (stat.isDirectory()) await walk(realPath, relativePath);
      else if (stat.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SKIPPED_EXTENSIONS.has(ext) || EXCLUDED_FILES.has(entry.name.toLowerCase())) continue;
        const groupKey = relativeBase || '.';
        if (!groups.has(groupKey)) groups.set(groupKey, { folderName: relativeBase || 'Root Files', relativePathForDisplay: groupKey, files: [] });
        groups.get(groupKey).files.push({
          name: entry.name, size: stat.size, formattedSize: formatSize(stat.size),
          extension: ext.startsWith('.') ? ext.slice(1) : ext, downloadPath: relativePath
        });
      }
    }
  }
  await walk(course.courseDir);
  const filesByFolder = [...groups.values()].sort((a, b) => a.relativePathForDisplay === '.' ? -1 : b.relativePathForDisplay === '.' ? 1 : a.folderName.localeCompare(b.folderName));
  for (const group of filesByFolder) group.files.sort((a, b) => a.name.localeCompare(b.name));
  return { courseTitle: course.title, filesByFolder };
}
