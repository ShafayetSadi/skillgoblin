import { createHash } from 'node:crypto';
import path from 'node:path';

export function normalizeCourseRelativePath(relativePath) {
  if (!relativePath || typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
    throw new Error('Course relative path must be a non-empty relative path');
  }
  if (relativePath.includes('\0') || relativePath.includes('\\')) throw new Error('Course relative path contains an invalid character');
  const normalized = path.posix.normalize(relativePath.replaceAll(path.sep, '/'));
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
    throw new Error('Course relative path escapes its root');
  }
  return normalized;
}

export function deriveCourseId(rootId, relativePath) {
  const identity = `${rootId}\0${normalizeCourseRelativePath(relativePath)}`;
  const bytes = createHash('sha256').update(identity).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
