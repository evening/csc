import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { driveAdd } from '../../src/commands/drive-add';
import { scan } from '../../src/commands/scan';
import { check } from '../../src/commands/check';
import { openDb } from '../../src/db/client';
import { locations, nasHashCache } from '../../src/db/schema';
import { makeTmpDir, cleanup, writeTestFile } from '../helpers';
import { join } from 'node:path';
import { rename } from 'node:fs/promises';

let workDir: string;
let drive: string;
let nas: string;
let lines: string[] = [];

beforeEach(async () => {
  workDir = await makeTmpDir();
  process.env.CSC_DB = join(workDir, 'catalog.db');
  drive = join(workDir, 'drive');
  nas = join(workDir, 'nas');
  await writeTestFile(drive, '.keep', '');
  await writeTestFile(nas, '.keep', '');
  lines = [];
  spyOn(console, 'log').mockImplementation((s: string) => { lines.push(s); });
});

afterEach(async () => {
  delete process.env.CSC_DB;
  await cleanup(workDir);
});

describe('integration: NAS rename is a re-hash-once event', () => {
  it('file renamed on NAS still reports as backed up on the original drive', async () => {
    // Setup: same content on drive and NAS
    await writeTestFile(drive, 'movie1.mkv', 'movie content');
    await writeTestFile(nas, 'movie1.mkv', 'movie content');
    await driveAdd({ positional: ['hd3'], flags: {} });
    await scan({ positional: ['hd3'], flags: { mount: drive } });

    // Verify backed up before rename
    lines = [];
    await check({ positional: [nas], flags: {} });
    expect(lines.join('\n')).toMatch(/✓.*movie1\.mkv.*hd3/);

    // Rename on NAS only (drive untouched)
    await rename(join(nas, 'movie1.mkv'), join(nas, 'movie2.mkv'));

    // Verify still backed up after rename (re-hashed against cache miss, found by content)
    lines = [];
    await check({ positional: [nas], flags: {} });
    const out = lines.join('\n');
    expect(out).toMatch(/✓.*movie2\.mkv.*hd3/);
    expect(out).not.toContain('movie1.mkv'); // file no longer exists at old path
  });

  it('location row path_on_drive is unchanged after a NAS rename', async () => {
    await writeTestFile(drive, 'movie1.mkv', 'X');
    await writeTestFile(nas, 'movie1.mkv', 'X');
    await driveAdd({ positional: ['hd3'], flags: {} });
    await scan({ positional: ['hd3'], flags: { mount: drive } });

    await rename(join(nas, 'movie1.mkv'), join(nas, 'movie2.mkv'));
    // No re-scan of hd3, no scan command — just a query
    await check({ positional: [nas], flags: {} });

    // Verify the location row on hd3 still says movie1.mkv
    const db = await openDb();
    const locs = await db.select({ p: locations.pathOnDrive }).from(locations);
    const paths = locs.map(l => l.p);
    expect(paths).toContain('movie1.mkv');
    expect(paths).not.toContain('movie2.mkv'); // drive wasn't rescanned, path is informational
  });

  it('cache has entries for both old and new paths after the rename + check', async () => {
    await writeTestFile(nas, 'movie1.mkv', 'X');
    await driveAdd({ positional: ['hd3'], flags: {} });
    // Trigger initial cache population (no drive scan needed for cache)
    await check({ positional: [nas], flags: {} });

    await rename(join(nas, 'movie1.mkv'), join(nas, 'movie2.mkv'));
    await check({ positional: [nas], flags: {} });

    // Stale cache row for old path remains (harmless); new row for new path
    const db = await openDb();
    const cached = await db.select({ p: nasHashCache.path }).from(nasHashCache);
    const paths = cached.map(c => c.p);
    expect(paths).toContain(join(nas, 'movie1.mkv'));
    expect(paths).toContain(join(nas, 'movie2.mkv'));
  });
});
