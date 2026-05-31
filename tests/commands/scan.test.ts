import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { scan } from '../../src/commands/scan';
import { driveAdd } from '../../src/commands/drive-add';
import { openDb } from '../../src/db/client';
import { drives, files, locations } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { makeTmpDir, cleanup, writeTestFile } from '../helpers';
import { writeSentinel, readSentinel } from '../../src/sentinel';
import { join } from 'node:path';
import { unlink, utimes } from 'node:fs/promises';

let workDir: string;
let mount: string;

beforeEach(async () => {
  workDir = await makeTmpDir();
  process.env.CSC_DB = join(workDir, 'catalog.db');
  mount = join(workDir, 'mnt');
  await writeTestFile(mount, '.keep', '');
  await driveAdd({ positional: ['hd3'], flags: {} });
});
afterEach(async () => {
  delete process.env.CSC_DB;
  await cleanup(workDir);
});

describe('scan', () => {
  it('first scan writes a sentinel and records files', async () => {
    await writeTestFile(mount, 'a.bin', 'aaa');
    await writeTestFile(mount, 'sub/b.bin', 'bbb');
    await scan({ positional: ['hd3'], flags: { mount } });

    const sentinel = await readSentinel(mount);
    expect(sentinel).not.toBeNull();

    const db = await openDb();
    const fileRows = await db.select().from(files);
    expect(fileRows.length).toBe(3); // a.bin, b.bin, .keep
    const locs = await db.select().from(locations);
    expect(locs.length).toBe(3);
    expect(locs.every((l) => l.verification === 'scanned')).toBe(true);

    const drv = (await db.select().from(drives).where(eq(drives.label, 'hd3')))[0]!;
    expect(drv.driveUuid).toBe(sentinel!.uuid);
    expect(drv.lastScanned).not.toBeNull();
  });

  it('refuses when sentinel is missing on subsequent scan', async () => {
    await writeTestFile(mount, 'a.bin', 'a');
    await scan({ positional: ['hd3'], flags: { mount } });
    await unlink(join(mount, '.csc-drive-id'));
    await expect(scan({ positional: ['hd3'], flags: { mount } })).rejects.toThrow(/sentinel/i);
  });

  it('refuses when sentinel uuid mismatches recorded uuid', async () => {
    await writeTestFile(mount, 'a.bin', 'a');
    await scan({ positional: ['hd3'], flags: { mount } });
    await unlink(join(mount, '.csc-drive-id'));
    await writeSentinel(mount, 'hd3'); // a fresh random uuid
    await expect(scan({ positional: ['hd3'], flags: { mount } })).rejects.toThrow(/uuid/i);
  });

  it('is idempotent: re-running produces the same row counts', async () => {
    await writeTestFile(mount, 'a.bin', 'a');
    await writeTestFile(mount, 'b.bin', 'b');
    await scan({ positional: ['hd3'], flags: { mount } });
    const db = await openDb();
    const before = (await db.select().from(locations)).length;
    await scan({ positional: ['hd3'], flags: { mount } });
    const after = (await db.select().from(locations)).length;
    expect(after).toBe(before);
  });

  it('prunes scanned locations for files that vanished from a full-drive rescan', async () => {
    const p1 = await writeTestFile(mount, 'keep.bin', 'k');
    const p2 = await writeTestFile(mount, 'gone.bin', 'g');
    await scan({ positional: ['hd3'], flags: { mount } });
    await unlink(p2);
    await scan({ positional: ['hd3'], flags: { mount } });

    const db = await openDb();
    const locs = await db.select({ p: locations.pathOnDrive }).from(locations);
    expect(locs.map((l) => l.p).sort()).toEqual(['.keep', 'keep.bin'].sort());
  });

  it('subtree scan only prunes within the subtree', async () => {
    await writeTestFile(mount, 'movies/a.mkv', 'a');
    await writeTestFile(mount, 'movies/b.mkv', 'b');
    await writeTestFile(mount, 'shows/c.mkv', 'c');
    await scan({ positional: ['hd3'], flags: { mount } });

    await unlink(join(mount, 'movies/b.mkv'));
    await unlink(join(mount, 'shows/c.mkv'));

    // scan only the movies/ subtree
    await scan({ positional: ['hd3', 'movies'], flags: { mount } });

    const db = await openDb();
    const paths = (await db.select({ p: locations.pathOnDrive }).from(locations))
      .map((r) => r.p).sort();
    // movies/b.mkv pruned (was in subtree); shows/c.mkv NOT pruned (outside subtree)
    expect(paths).toContain('shows/c.mkv');
    expect(paths).toContain('movies/a.mkv');
    expect(paths).not.toContain('movies/b.mkv');
  });

  it('asserted rows are not pruned', async () => {
    await writeTestFile(mount, 'a.bin', 'a');
    await scan({ positional: ['hd3'], flags: { mount } });
    const db = await openDb();
    // manually convert the row to asserted
    await db.update(locations).set({ verification: 'asserted' }).execute();
    await unlink(join(mount, 'a.bin'));
    await scan({ positional: ['hd3'], flags: { mount } });
    const remaining = await db.select().from(locations);
    // a.bin's asserted location must survive even though the file is gone from disk
    const aBinRow = remaining.find((r) => r.pathOnDrive === 'a.bin');
    expect(aBinRow).not.toBeUndefined();
    expect(aBinRow!.verification).toBe('asserted');
  });

  it('resume re-hashes when mtime changes', async () => {
    const p = await writeTestFile(mount, 'a.bin', 'a');
    await scan({ positional: ['hd3'], flags: { mount } });
    const db = await openDb();
    const beforeMtime = (await db.select().from(locations).where(eq(locations.pathOnDrive, 'a.bin')))[0]!.mtime;

    // bump mtime by setting it to 1 hour in the future
    const future = new Date(Date.now() + 3600 * 1000);
    await utimes(p, future, future);
    await scan({ positional: ['hd3'], flags: { mount } });
    const afterMtime = (await db.select().from(locations).where(eq(locations.pathOnDrive, 'a.bin')))[0]!.mtime;
    expect(afterMtime).toBeGreaterThan(beforeMtime!);
  });

  it('subtree prune does not match similar siblings (underscore-LIKE-collision)', async () => {
    // music_archive and music-archive are different dirs; pruning the first
    // must not affect the second. SQLite LIKE treats _ as "any char" so this
    // is a guard against using LIKE for prefix matching.
    await writeTestFile(mount, 'music_archive/a.mp3', 'a');
    await writeTestFile(mount, 'music-archive/b.mp3', 'b');
    await scan({ positional: ['hd3'], flags: { mount } });

    // delete b.mp3 from disk; scan only music_archive subtree
    await unlink(join(mount, 'music-archive/b.mp3'));
    await scan({ positional: ['hd3', 'music_archive'], flags: { mount } });

    const db = await openDb();
    const paths = (await db.select({ p: locations.pathOnDrive }).from(locations))
      .map((r) => r.p).sort();
    // music_archive/a.mp3 still present (was in subtree, file still exists)
    expect(paths).toContain('music_archive/a.mp3');
    // music-archive/b.mp3 must still be present even though file is gone,
    // because that subtree wasn't scanned
    expect(paths).toContain('music-archive/b.mp3');
  });
});
