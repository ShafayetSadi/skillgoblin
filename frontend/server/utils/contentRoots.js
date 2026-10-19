import fs from 'node:fs';
import path from 'node:path';

const ROOT_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;

function configurationError(message) {
  const error = new Error(`Invalid CONTENT_DIRS: ${message}`);
  error.code = 'INVALID_CONTENT_DIRS';
  return error;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function parseContentRoots(env = process.env, { checkFilesystem = true } = {}) {
  if (env.CONTENT_DIR !== undefined || env.CONTENT_PATH !== undefined) {
    throw configurationError('CONTENT_DIR and CONTENT_PATH are unsupported; configure named roots only');
  }
  const raw = env.CONTENT_DIRS;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw configurationError('a non-empty value is required (for example, main=/courses/main)');
  }
  const entries = raw.split(',');
  if (entries.some(entry => entry.trim() === '')) throw configurationError('empty root entries are not allowed');

  const roots = entries.map((entry, position) => {
    const separator = entry.indexOf('=');
    if (separator <= 0) throw configurationError(`entry "${entry.trim()}" must use name=/absolute/path`);
    const id = entry.slice(0, separator).trim();
    const configuredPath = entry.slice(separator + 1).trim();
    if (!ROOT_ID_PATTERN.test(id)) throw configurationError(`root name "${id}" must match ${ROOT_ID_PATTERN}`);
    if (!configuredPath || !path.isAbsolute(configuredPath)) throw configurationError(`root "${id}" must use an absolute path`);

    const normalizedPath = path.resolve(configuredPath);
    let canonicalPath = normalizedPath;
    if (checkFilesystem) {
      let stat;
      try {
        canonicalPath = fs.realpathSync.native(normalizedPath);
        stat = fs.statSync(canonicalPath);
        fs.accessSync(canonicalPath, fs.constants.R_OK | fs.constants.X_OK);
      } catch (error) {
        throw configurationError(`root "${id}" is unavailable: ${error.message}`);
      }
      if (!stat.isDirectory()) throw configurationError(`root "${id}" is not a directory`);
    }
    return Object.freeze({ id, configuredPath: normalizedPath, canonicalPath, position });
  });

  const ids = new Set();
  for (const root of roots) {
    if (ids.has(root.id)) throw configurationError(`duplicate root name "${root.id}"`);
    ids.add(root.id);
  }
  for (let i = 0; i < roots.length; i += 1) {
    for (let j = i + 1; j < roots.length; j += 1) {
      const a = roots[i];
      const b = roots[j];
      if (isWithin(a.canonicalPath, b.canonicalPath) || isWithin(b.canonicalPath, a.canonicalPath)) {
        throw configurationError(`roots "${a.id}" and "${b.id}" overlap`);
      }
    }
  }
  return Object.freeze(roots);
}

export function synchronizeContentRoots(db, roots) {
  const configuredIds = new Set(roots.map(root => root.id));
  const upsert = db.prepare(`
    INSERT INTO content_roots (
      id, configured_path, canonical_path, position, is_configured, is_available,
      created_at, updated_at, last_seen_at
    ) VALUES (?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      configured_path = excluded.configured_path,
      canonical_path = excluded.canonical_path,
      position = excluded.position,
      is_configured = 1,
      is_available = 1,
      updated_at = CURRENT_TIMESTAMP,
      last_seen_at = CURRENT_TIMESTAMP
  `);
  db.transaction(() => {
    for (const root of roots) upsert.run(root.id, root.configuredPath, root.canonicalPath, root.position);
    const known = db.prepare('SELECT id FROM content_roots').all();
    const deactivate = db.prepare(`UPDATE content_roots SET is_configured=0, is_available=0, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
    const hideCourses = db.prepare(`UPDATE courses SET available=0, updated_at=CURRENT_TIMESTAMP WHERE content_root_id=?`);
    for (const row of known) {
      if (!configuredIds.has(row.id)) {
        deactivate.run(row.id);
        hideCourses.run(row.id);
      }
    }
  })();
}

export function findOwningRoot(roots, candidatePath) {
  const candidate = path.resolve(candidatePath);
  return roots.find(root => isWithin(root.canonicalPath, candidate)) || null;
}

export function pathIsWithin(parent, candidate) {
  return isWithin(path.resolve(parent), path.resolve(candidate));
}
