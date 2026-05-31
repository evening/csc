import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { driveAdd } from '../../src/commands/drive-add';
import { openDb } from '../../src/db/client';
import { drives } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { makeTmpDir, cleanup } from '../helpers';
import { join } from 'node:path';

let dir: string;
let dbFile: string;

beforeEach(async () => {
  dir = await makeTmpDir();
  dbFile = join(dir, 'catalog.db');
  process.env.CSC_DB = dbFile;
});
afterEach(async () => {
  delete process.env.CSC_DB;
  await cleanup(dir);
});

describe('drive add', () => {
  it('inserts a new drive row with the given label and notes', async () => {
    await driveAdd({ positional: ['hd3'], flags: { notes: 'main backup' } });
    const db = await openDb(dbFile);
    const rows = await db.select().from(drives).where(eq(drives.label, 'hd3'));
    expect(rows.length).toBe(1);
    expect(rows[0]!.notes).toBe('main backup');
    expect(rows[0]!.driveUuid).toBeNull();
  });

  it('rejects a duplicate label', async () => {
    await driveAdd({ positional: ['hd3'], flags: {} });
    await expect(driveAdd({ positional: ['hd3'], flags: {} })).rejects.toThrow();
  });

  it('errors when label is missing', async () => {
    await expect(driveAdd({ positional: [], flags: {} })).rejects.toThrow(/label/);
  });
});
