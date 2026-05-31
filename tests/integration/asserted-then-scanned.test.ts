import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { driveAdd } from '../../src/commands/drive-add';
import { scan } from '../../src/commands/scan';
import { check } from '../../src/commands/check';
import { assertCmd } from '../../src/commands/assert';
import { openDb } from '../../src/db/client';
import { locations } from '../../src/db/schema';
import { makeTmpDir, cleanup, writeTestFile } from '../helpers';
import { join } from 'node:path';

let workDir: string;
let nas: string;
let lines: string[] = [];

beforeEach(async () => {
  workDir = await makeTmpDir();
  process.env.CSC_DB = join(workDir, 'catalog.db');
  nas = join(workDir, 'nas');
  await writeTestFile(nas, '.keep', '');
  lines = [];
  spyOn(console, 'log').mockImplementation((s: string) => { lines.push(s); });
});

afterEach(async () => {
  delete process.env.CSC_DB;
  await cleanup(workDir);
});

describe('integration: asserted location upgrades to scanned after a real scan', () => {
  it('check shows ⚠ after assert, then ✓ after the real scan', async () => {
    await driveAdd({ positional: ['hd5'], flags: {} });
    await writeTestFile(nas, 'movie.mkv', 'X');

    // Assert: user knows it's on hd5 but the drive is away
    await assertCmd({ positional: ['hd5', nas], flags: { yes: true } });

    // check shows ⚠ asserted
    lines = [];
    await check({ positional: [nas], flags: {} });
    expect(lines.join('\n')).toMatch(/⚠.*movie\.mkv.*hd5.*asserted/);

    // Later: hd5 is plugged in, user copies the file to its mount and scans
    const driveHd5 = join(workDir, 'hd5-mount');
    await writeTestFile(driveHd5, 'movie.mkv', 'X');
    await scan({ positional: ['hd5'], flags: { mount: driveHd5 } });

    // check now shows ✓ scanned (no more ⚠ for this file)
    lines = [];
    await check({ positional: [nas], flags: {} });
    const out = lines.join('\n');
    expect(out).toMatch(/✓.*movie\.mkv.*hd5/);
    expect(out).not.toMatch(/movie\.mkv.*asserted/); // no longer asserted-only
  });

  it('location row verification transitions from asserted to scanned', async () => {
    await driveAdd({ positional: ['hd5'], flags: {} });
    await writeTestFile(nas, 'movie.mkv', 'X');

    await assertCmd({ positional: ['hd5', nas], flags: { yes: true } });

    let db = await openDb();
    let movieLoc = (await db.select().from(locations))
      .find(l => l.pathOnDrive === 'movie.mkv');
    expect(movieLoc).toBeDefined();
    expect(movieLoc!.verification).toBe('asserted');
    expect(movieLoc!.mtime).toBeNull();

    const driveHd5 = join(workDir, 'hd5-mount');
    await writeTestFile(driveHd5, 'movie.mkv', 'X');
    await scan({ positional: ['hd5'], flags: { mount: driveHd5 } });

    db = await openDb();
    movieLoc = (await db.select().from(locations))
      .find(l => l.pathOnDrive === 'movie.mkv');
    expect(movieLoc!.verification).toBe('scanned');
    expect(movieLoc!.mtime).not.toBeNull(); // real mtime now populated
  });
});
