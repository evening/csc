import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { check } from '../../src/commands/check';
import { scan } from '../../src/commands/scan';
import { driveAdd } from '../../src/commands/drive-add';
import { openDb } from '../../src/db/client';
import { nasHashCache } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { makeTmpDir, cleanup, writeTestFile } from '../helpers';
import { join } from 'node:path';

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
  await driveAdd({ positional: ['hd3'], flags: {} });
  lines = [];
  spyOn(console, 'log').mockImplementation((s: string) => { lines.push(s); });
});
afterEach(async () => {
  delete process.env.CSC_DB;
  await cleanup(workDir);
});

describe('check', () => {
  it('reports a file present on the drive as backed up', async () => {
    await writeTestFile(drive, 'movie.mkv', 'X');
    await writeTestFile(nas, 'movie.mkv', 'X');
    await scan({ positional: ['hd3'], flags: { mount: drive } });
    lines = [];
    await check({ positional: [nas], flags: {} });
    const out = lines.join('\n');
    expect(out).toContain('movie.mkv');
    expect(out).toMatch(/✓.*hd3/);
  });

  it('reports a file absent from any drive as not backed up', async () => {
    await writeTestFile(nas, 'orphan.mkv', 'Y');
    await check({ positional: [nas], flags: {} });
    expect(lines.join('\n')).toMatch(/✗.*orphan\.mkv/);
  });

  it('populates nas_hash_cache on first walk and reuses it', async () => {
    await writeTestFile(nas, 'movie.mkv', 'cache-me');
    await check({ positional: [nas], flags: {} });
    const db = await openDb();
    const cached = await db.select().from(nasHashCache).where(eq(nasHashCache.path, join(nas, 'movie.mkv')));
    expect(cached.length).toBe(1);
    const firstXxh3 = cached[0]!.xxh3;

    // run again; xxh3 stays the same
    await check({ positional: [nas], flags: {} });
    const cached2 = await db.select().from(nasHashCache).where(eq(nasHashCache.path, join(nas, 'movie.mkv')));
    expect(cached2[0]!.xxh3).toBe(firstXxh3);
  });

  it('summary mode emits aggregate counts', async () => {
    await writeTestFile(nas, 'a.bin', 'aa');
    await writeTestFile(nas, 'b.bin', 'bb');
    lines = [];
    await check({ positional: [nas], flags: { summary: true } });
    const out = lines.join('\n');
    expect(out).toMatch(/\d+ files/);
    expect(out).toMatch(/not backed up/);
  });
});
