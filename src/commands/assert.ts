import type { Args } from '../cli';
import { openDb } from '../db/client';
import { drives, files, locations } from '../db/schema';
import { walk } from '../walker';
import { hashFile } from '../hash';
import { and, eq } from 'drizzle-orm';
import { relative } from 'node:path';

export async function assertCmd(args: Args): Promise<void> {
  const label = args.positional[0];
  const nasPath = args.positional[1];
  if (!label || !nasPath) throw new Error('usage: csc assert <label> <nas-path> --yes');
  if (args.flags.yes !== true) {
    throw new Error('refusing to assert without --yes. asserted rows are never auto-verified.');
  }

  const db = await openDb();
  const drv = (await db.select().from(drives).where(eq(drives.label, label)))[0];
  if (!drv) throw new Error(`unknown drive label: ${label}`);

  const now = () => new Date().toISOString();
  let count = 0;
  for await (const entry of walk(nasPath)) {
    const xxh3 = await hashFile(entry.absolutePath);

    db.transaction((tx) => {
      const existingFile = tx.select().from(files)
        .where(and(eq(files.xxh3, xxh3), eq(files.sizeBytes, entry.sizeBytes)))
        .all()[0];
      let fileId: number;
      if (existingFile) {
        tx.update(files).set({ lastSeen: now() }).where(eq(files.id, existingFile.id)).run();
        fileId = existingFile.id;
      } else {
        const [ins] = tx.insert(files).values({
          xxh3, sizeBytes: entry.sizeBytes, firstSeen: now(), lastSeen: now(),
        }).returning().all();
        fileId = ins!.id;
      }

      const pathOnDrive = relative(nasPath, entry.absolutePath); // informational; we don't know the real path on the cold drive
      const existingLoc = tx.select().from(locations)
        .where(and(eq(locations.fileId, fileId), eq(locations.driveId, drv.id)))
        .all()[0];
      if (existingLoc) {
        // do not downgrade scanned → asserted; only update asserted's recordedAt
        if (existingLoc.verification === 'scanned') return;
        tx.update(locations).set({
          pathOnDrive, recordedAt: now(),
        }).where(eq(locations.id, existingLoc.id)).run();
      } else {
        tx.insert(locations).values({
          fileId, driveId: drv.id, pathOnDrive,
          verification: 'asserted', mtime: null, recordedAt: now(),
        }).run();
      }
      count++;
    });
  }
  console.log(`asserted ${count} files on ${label}. these will appear as ⚠ in check until you scan ${label}.`);
}
