import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseContentRoots } from '../../server/utils/contentRoots.js';

const created = [];
function temp(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sg-${name}-`));
  created.push(dir);
  return dir;
}
afterEach(() => { while (created.length) fs.rmSync(created.pop(), { recursive: true, force: true }); });

describe('CONTENT_DIRS', () => {
  it('parses and trims multiple named absolute roots', () => {
    const a = temp('a'); const b = temp('b');
    const roots = parseContentRoots({ CONTENT_DIRS: ` primary = ${a} , archive=${b} ` });
    expect(roots.map(root => root.id)).toEqual(['primary', 'archive']);
    expect(roots.map(root => root.canonicalPath)).toEqual([a, b]);
  });
  it.each([
    [{}, /required/],
    [{ CONTENT_DIRS: 'relative=content' }, /absolute/],
    [{ CONTENT_DIRS: 'bad name=/tmp' }, /must match/],
    [{ CONTENT_DIRS: 'main=/tmp,' }, /empty root/],
    [{ CONTENT_DIRS: 'main=/tmp', CONTENT_DIR: '/tmp' }, /unsupported/],
    [{ CONTENT_DIRS: 'main=/tmp', CONTENT_PATH: '/tmp' }, /unsupported/]
  ])('rejects invalid configuration %#', (env, message) => expect(() => parseContentRoots(env)).toThrow(message));
  it('rejects duplicate root names', () => {
    const a = temp('a'); const b = temp('b');
    expect(() => parseContentRoots({ CONTENT_DIRS: `main=${a},main=${b}` })).toThrow(/duplicate/);
  });
  it('rejects duplicate and nested canonical roots', () => {
    const a = temp('a'); const nested = path.join(a, 'nested'); fs.mkdirSync(nested);
    expect(() => parseContentRoots({ CONTENT_DIRS: `a=${a},nested=${nested}` })).toThrow(/overlap/);
  });
  it('allows a root path that is itself a symlink', () => {
    const target = temp('target'); const parent = temp('link'); const link = path.join(parent, 'root');
    fs.symlinkSync(target, link, 'dir');
    expect(parseContentRoots({ CONTENT_DIRS: `main=${link}` })[0].canonicalPath).toBe(target);
  });
});
