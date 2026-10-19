import { addVideoIds } from './videoIdentity.js';
import fs from 'fs';
import path from 'path';
import {
  generateCourseId,
  generateLegacyId,
  shortStableHash,
  naturalSort,
  VIDEO_EXTENSIONS
} from './courseHelpers';
import { applyCourseJsonOverride } from './courseJsonOverride.js';
import { pathIsWithin } from './contentRoots.js';

function isVideoFile(name) {
  return VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase());
}

async function safeFile(coursePath, candidate) {
  try {
    const [root, target] = await Promise.all([fs.promises.realpath(coursePath), fs.promises.realpath(candidate)]);
    return pathIsWithin(root, target);
  } catch {
    return false;
  }
}

function stripVideoExt(name) {
  return name.replace(/\.[^.]+$/, '');
}

// Build a per-video subtitle hint: if `lesson1.srt` exists next to
// `lesson1.mp4`, return the corresponding `.vtt` filename so the client can
// request it directly. The content endpoint converts the sibling .srt on
// demand; clients don't need to know about the .srt.
async function findSubtitleSibling(videoFilePath) {
  const dir = path.dirname(videoFilePath);
  const base = path.basename(videoFilePath, path.extname(videoFilePath));
  const srtName = `${base}.srt`;
  const vttName = `${base}.vtt`;
  const candidate = path.join(dir, srtName);
  try {
    await fs.promises.access(candidate);
    const language = String(process.env.SUBTITLE_LANGUAGE || 'en').trim() || 'en';
    const label = String(process.env.SUBTITLE_LABEL || language).trim() || language;
    return { file: vttName, language, label };
  } catch {
    return null;
  }
}

// Function to generate lessons from the folder structure
export const generateLessonsFromFolder = async (coursePath) => {
  const lessons = [];

  const items = await fs.promises.readdir(coursePath, { withFileTypes: true });
  const lessonDirs = items
    .filter((item) => item.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const rootVideos = items.filter(
    (item) => !item.isDirectory() && isVideoFile(item.name),
  );

  if (rootVideos.length > 0) {
    const introVideos = await Promise.all(rootVideos.map(async (video) => {
      const fullPath = path.join(coursePath, video.name);
      if (!await safeFile(coursePath, fullPath)) return null;
      const subtitle = await findSubtitleSibling(fullPath);
      const entry = {
        title: stripVideoExt(video.name).replace(/_/g, ' '),
        file: video.name,
      };
      if (subtitle) {
        entry.subtitle = subtitle.file;
        entry.subtitleLanguage = subtitle.language;
        entry.subtitleLabel = subtitle.label;
      }
      return entry;
    }));

    const safeIntroVideos = introVideos.filter(Boolean);
    safeIntroVideos.sort((a, b) => naturalSort(a, b));

    if (safeIntroVideos.length > 0) {
      lessons.push({
        id: 'main-content', title: 'Main Content', folder: '', videos: safeIntroVideos,
      });
    }
  }

  const usedLessonIds = new Set(lessons.map(lesson => lesson.id));

  for (const lessonDir of lessonDirs) {
    const lessonPath = path.join(coursePath, lessonDir.name);
    const lessonEntries = await fs.promises.readdir(lessonPath, { withFileTypes: true });
    const lessonVideos = await Promise.all(
      lessonEntries
        .filter((item) => !item.isDirectory() && isVideoFile(item.name))
        .map(async (video) => {
          const fullPath = path.join(lessonPath, video.name);
          if (!await safeFile(coursePath, fullPath)) return null;
          const subtitle = await findSubtitleSibling(fullPath);
          const entry = {
            title: stripVideoExt(video.name).replace(/_/g, ' '),
            file: video.name,
          };
          if (subtitle) {
            entry.subtitle = subtitle.file;
            entry.subtitleLanguage = subtitle.language;
            entry.subtitleLabel = subtitle.label;
          }
          return entry;
        }),
    );

    const safeLessonVideos = lessonVideos.filter(Boolean);
    if (safeLessonVideos.length > 0) {
      // Keep old non-empty lesson IDs so existing progress remains attached.
      // Only empty or colliding IDs move to a deterministic hashed form.
      let lessonId = generateLegacyId(lessonDir.name);
      if (!lessonId) lessonId = generateCourseId(lessonDir.name);
      if (usedLessonIds.has(lessonId)) {
        lessonId = `${lessonId || 'lesson'}-${shortStableHash(lessonDir.name)}`;
      }
      let suffix = 2;
      const baseLessonId = lessonId;
      while (usedLessonIds.has(lessonId)) {
        lessonId = `${baseLessonId}-${suffix++}`;
      }
      usedLessonIds.add(lessonId);

      safeLessonVideos.sort((a, b) => naturalSort(a, b));

      lessons.push({
        id: lessonId,
        title: lessonDir.name,
        folder: lessonDir.name,
        videos: safeLessonVideos,
      });
    }
  }

  lessons.sort((a, b) => naturalSort(a, b));
  return lessons;
};

// Generate course metadata from folder structure, then layer course.json
// overrides on top so the operator's intent wins over auto-detection.
export const generateCourseJson = async (courseDir, coursePath, courseId) => {
  if (!courseId) throw new Error('A scanner-assigned course ID is required');
  const lessons = await generateLessonsFromFolder(coursePath);

  const autoDetected = {
    id: courseId,
    title: courseDir,
    description: `Course: ${courseDir}`,
    thumbnail: 'thumbnail.png',
    category: 'Uncategorized',
    releaseDate: new Date().toISOString().split('T')[0],
    lessons,
    lastUpdate: Date.now(),
  };

  const merged = applyCourseJsonOverride(coursePath, autoDetected);
  return addVideoIds(merged);
};
