import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePathInCourse, resolveExistingPathInCourse } from '../../server/utils/courseHelpers.js';

let base;
let courseDir;
let outside;
let course;
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-paths-'));
  courseDir = path.join(base, 'course'); outside = path.join(base, 'outside');
  fs.mkdirSync(courseDir); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(courseDir, 'video.mp4'), 'video');
  fs.writeFileSync(path.join(outside, 'secret.mp4'), 'secret');
  course = { courseDir, canonicalCourseDir: fs.realpathSync(courseDir) };
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe('course path containment', () => {
  it('resolves a normal file', () => expect(resolveExistingPathInCourse(course, 'video.mp4')).toBe(path.join(courseDir, 'video.mp4')));
  it.each(['../outside/secret.mp4', '/etc/passwd', '..', 'lesson\\video.mp4'])('rejects unsafe path %s', value => {
    expect(() => resolvePathInCourse(course, value)).toThrow();
  });
  it('rejects a symlink escaping the course', () => {
    fs.symlinkSync(path.join(outside, 'secret.mp4'), path.join(courseDir, 'escape.mp4'));
    expect(() => resolveExistingPathInCourse(course, 'escape.mp4')).toThrow();
  });
  it('allows a symlink whose target remains in the course', () => {
    fs.symlinkSync(path.join(courseDir, 'video.mp4'), path.join(courseDir, 'alias.mp4'));
    expect(resolveExistingPathInCourse(course, 'alias.mp4')).toBe(path.join(courseDir, 'video.mp4'));
  });
});
