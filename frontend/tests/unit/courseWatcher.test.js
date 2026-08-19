import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { topLevelCoursePath } from '../../server/utils/courseWatcher.js';
import { deriveCourseId } from '../../server/utils/courseIdentity.js';

describe('multi-root watcher routing and identity', () => {
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
});
