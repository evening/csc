import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { driveAdd } from '../../src/commands/drive-add';
import { scan } from '../../src/commands/scan';
import { check } from '../../src/commands/check';
import { whereis } from '../../src/commands/whereis';
import { openDb } from '../../src/db/client';
import { nasHashCache } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { makeTmpDir, cleanup, writeTestFile } from '../helpers';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

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

describe('integration: NAS file edited in place', () => {
  it('size change invalidates cache and check reports the new content as not backed up', async () => {
    await writeTestFile(drive, 'movie.mkv', 'AAAA');
    await writeTestFile(nas, 'movie.mkv', 'AAAA');
    await driveAdd({ positional: ['hd3'], flags: {} });
    await scan({ positional: ['hd3'], flags: { mount: drive } });

    // Verify ✓ before edit
    lines = [];
    await check({ positional: [nas], flags: {} });
    expect(lines.join('\n')).toMatch(/✓.*movie\.mkv.*hd3/);

    // Edit in place with DIFFERENT SIZE (8 bytes vs 4 bytes) — guarantees cache miss
    await writeFile(join(nas, 'movie.mkv'), 'BBBBBBBB');

    // Check re-evaluates: new content has different hash, not in catalog
    lines = [];
    await check({ positional: [nas], flags: {} });
    expect(lines.join('\n')).toMatch(/✗.*movie\.mkv.*not backed up/);

    // Cache row updated to new hash
    const db = await openDb();
    const cached = (await db.select().from(nasHashCache).where(eq(nasHashCache.path, join(nas, 'movie.mkv'))))[0];
    expect(cached).toBeDefined();
    expect(cached!.sizeBytes).toBe(8);
  });

  it('the original (still on hd3) is findable by its hash after the NAS file changed', async () => {
    await writeTestFile(drive, 'movie.mkv', 'AAAA');
    await writeTestFile(nas, 'movie.mkv', 'AAAA');
    await driveAdd({ positional: ['hd3'], flags: {} });
    await scan({ positional: ['hd3'], flags: { mount: drive } });

    // Capture the original hash via whereis
    lines = [];
    await whereis({ positional: [join(nas, 'movie.mkv')], flags: {} });
    const out1 = lines.join('\n');
    const hashMatch = out1.match(/file ([0-9a-f]{16})/);
    expect(hashMatch).not.toBeNull();
    const originalHash = hashMatch![1]!;

    // Edit NAS file
    await writeFile(join(nas, 'movie.mkv'), 'BBBBBBBB');

    // The original hash still locates the file on hd3
    lines = [];
    await whereis({ positional: [originalHash], flags: {} });
    expect(lines.join('\n')).toContain('hd3 (scanned)');
  });
});
