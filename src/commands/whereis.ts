import type { Args } from '../cli';
import { openDb } from '../db/client';
import { drives, files, locations } from '../db/schema';
import { hashFile } from '../hash';
import { stat } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';

export async function whereis(args: Args): Promise<void> {
  const arg = args.positional[0];
  if (!arg) throw new Error('argument required: csc whereis <nas-path-or-hash>');
  const db = await openDb();

  // Hash-or-path heuristic: 16 lowercase hex chars → hash, else path
  let xxh3: string;
  let sizeBytes: number | null = null;
  if (/^[0-9a-f]{16}$/.test(arg)) {
    xxh3 = arg;
  } else {
    const s = await stat(arg);
    xxh3 = await hashFile(arg);
    sizeBytes = s.size;
  }

  const fileRows = sizeBytes != null
    ? await db.select().from(files).where(and(eq(files.xxh3, xxh3), eq(files.sizeBytes, sizeBytes)))
    : await db.select().from(files).where(eq(files.xxh3, xxh3));

  if (fileRows.length === 0) {
    console.log(`not in catalog`);
    return;
  }

  for (const f of fileRows) {
    const locs = await db.select({
      label: drives.label,
      verification: locations.verification,
      path: locations.pathOnDrive,
    }).from(locations)
      .innerJoin(drives, eq(drives.id, locations.driveId))
      .where(eq(locations.fileId, f.id));
    console.log(`file ${f.xxh3} (${f.sizeBytes} bytes):`);
    if (locs.length === 0) {
      console.log(`  no recorded locations`);
    }
    for (const l of locs) {
      console.log(`  ${l.label} (${l.verification})  ${l.path}`);
    }
  }
}
