import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { driveAdd } from '../../src/commands/drive-add';
import { scan } from '../../src/commands/scan';
import { check } from '../../src/commands/check';
import { whereis } from '../../src/commands/whereis';
import { eq } from 'drizzle-orm';
import { openDb } from '../../src/db/client';
import { files, locations } from '../../src/db/schema';
import { makeTmpDir, cleanup, writeTestFile } from '../helpers';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';

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

describe('integration: file deleted from NAS', () => {
  it('deleted NAS file does not appear in check output but catalog remains intact', async () => {
    await writeTestFile(drive, 'movie.mkv', 'X');
    await writeTestFile(nas, 'movie.mkv', 'X');
    await driveAdd({ positional: ['hd3'], flags: {} });
    await scan({ positional: ['hd3'], flags: { mount: drive } });

    // Before delete: file appears in check
    lines = [];
    await check({ positional: [nas], flags: {} });
    expect(lines.join('\n')).toContain('movie.mkv');

    // Delete from NAS
    await unlink(join(nas, 'movie.mkv'));

    // After delete: file does not appear (walk skips it)
    lines = [];
    await check({ positional: [nas], flags: {} });
    expect(lines.join('\n')).not.toContain('movie.mkv');

    // But the catalog still holds the location rows (including movie.mkv's row on hd3)
    const db = await openDb();
    const locs = await db.select({ p: locations.pathOnDrive }).from(locations);
    const paths = locs.map(l => l.p);
    expect(paths).toContain('movie.mkv');
  });

  it('whereis by hash still finds the file even after NAS delete', async () => {
    await writeTestFile(drive, 'movie.mkv', 'X');
    await writeTestFile(nas, 'movie.mkv', 'X');
    await driveAdd({ positional: ['hd3'], flags: {} });
    await scan({ positional: ['hd3'], flags: { mount: drive } });

    // Capture the hash before deleting the NAS copy
    const db = await openDb();
    const f = (await db.select().from(files).where(eq(files.sizeBytes, 1)))[0]!;

    await unlink(join(nas, 'movie.mkv'));

    lines = [];
    await whereis({ positional: [f.xxh3], flags: {} });
    expect(lines.join('\n')).toContain('hd3');
  });
});
