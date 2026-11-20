import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { realpathOrResolve } from './realpathOrResolve';

describe('realpathOrResolve', () => {
  it('returns the canonical (realpath) spelling of an existing path', () => {
    const existing = path.join(os.tmpdir(), `realpath-or-resolve-${process.pid}`);
    fs.mkdirSync(existing, { recursive: true });
    try {
      expect(realpathOrResolve(existing)).toBe(fs.realpathSync.native(existing));
    } finally {
      fs.rmdirSync(existing);
    }
  });

  it('falls back to the resolved absolute path when the entry does not exist', () => {
    const missing = path.join(os.tmpdir(), `realpath-or-resolve-missing-${process.pid}`, 'wt');
    expect(realpathOrResolve(missing)).toBe(path.resolve(missing));
  });
});
