import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { openDb, type DB } from '../src/db/client';
import { drives, files, locations, nasHashCache } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { makeTmpDir, cleanup } from './helpers';
import { join } from 'node:path';

let dir: string;
let db: DB;

beforeEach(async () => {
  dir = await makeTmpDir();
  db = await openDb(join(dir, 'catalog.db'));
});
afterEach(async () => { await cleanup(dir); });

describe('db schema', () => {
  it('drives.label is unique', async () => {
    await db.insert(drives).values({ label: 'hd3' }).execute();
    await expect(db.insert(drives).values({ label: 'hd3' }).execute()).rejects.toThrow();
  });

  it('files unique on (xxh3, size_bytes)', async () => {
    const row = { xxh3: 'abc', sizeBytes: 100, firstSeen: 'now', lastSeen: 'now' };
    await db.insert(files).values(row).execute();
    await expect(db.insert(files).values(row).execute()).rejects.toThrow();
    await db.insert(files).values({ ...row, sizeBytes: 101 }).execute(); // different size ok
  });

  it('locations unique on (file_id, drive_id)', async () => {
    const [drv] = await db.insert(drives).values({ label: 'hd3' }).returning();
    const [fl] = await db.insert(files).values({
      xxh3: 'x', sizeBytes: 1, firstSeen: 't', lastSeen: 't',
    }).returning();
    const loc = {
      fileId: fl!.id, driveId: drv!.id, pathOnDrive: '/a',
      verification: 'scanned' as const, recordedAt: 't',
    };
    await db.insert(locations).values(loc).execute();
    await expect(db.insert(locations).values({ ...loc, pathOnDrive: '/b' }).execute()).rejects.toThrow();
  });

  it('nas_hash_cache upsert by path', async () => {
    const row = { path: '/p', sizeBytes: 1, mtime: 1, xxh3: 'a', cachedAt: 't' };
    await db.insert(nasHashCache).values(row).execute();
    await db.insert(nasHashCache).values({ ...row, xxh3: 'b' })
      .onConflictDoUpdate({ target: nasHashCache.path, set: { xxh3: 'b' } })
      .execute();
    const [hit] = await db.select().from(nasHashCache).where(eq(nasHashCache.path, '/p'));
    expect(hit!.xxh3).toBe('b');
  });
});
