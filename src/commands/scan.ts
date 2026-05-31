import type { Args } from '../cli';
import { openDb } from '../db/client';
import { drives, files, locations } from '../db/schema';
import { resolveMount } from '../config';
import { readSentinel, writeSentinel } from '../sentinel';
import { walk } from '../walker';
import { hashFile } from '../hash';
import { and, eq, sql } from 'drizzle-orm';
import { statfs } from 'node:fs/promises';
import { join, relative } from 'node:path';

export async function scan(args: Args): Promise<void> {
  const label = args.positional[0];
  if (!label) throw new Error('label required: csc scan <label> [path]');
  const subtree = args.positional[1] ?? '';
  const mountFlag = typeof args.flags.mount === 'string' ? args.flags.mount : undefined;
  const mount = resolveMount(label, mountFlag);

  const db = await openDb();
  const driveRow = (await db.select().from(drives).where(eq(drives.label, label)))[0];
  if (!driveRow) {
    throw new Error(`unknown drive label: ${label}. run 'csc drive add ${label}' first.`);
  }

  // Sub-stage A: sentinel check
  const sentinel = await readSentinel(mount);
  if (driveRow.driveUuid == null) {
    // First scan: either adopt existing sentinel or write a new one
    if (sentinel) {
      await db.update(drives).set({ driveUuid: sentinel.uuid }).where(eq(drives.id, driveRow.id)).execute();
    } else {
      const written = await writeSentinel(mount, label);
      await db.update(drives).set({ driveUuid: written.uuid }).where(eq(drives.id, driveRow.id)).execute();
    }
  } else {
    if (!sentinel) {
      throw new Error(
        `sentinel missing at ${mount}. either the drive was wiped or this is the wrong drive. ` +
        `if you are certain, run 'csc drive rebind ${label} --yes'.`,
      );
    }
    if (sentinel.uuid !== driveRow.driveUuid) {
      throw new Error(
        `sentinel uuid mismatch at ${mount}.\n` +
        `  expected: ${driveRow.driveUuid}\n` +
        `  found:    ${sentinel.uuid}\n` +
        `the label "${label}" is mapped to a different physical drive than this one.`,
      );
    }
  }

  const scanRoot = subtree ? join(mount, subtree) : mount;
  const now = () => new Date().toISOString();
  const seenLocationIds = new Set<number>();

  // Sub-stages B + D: walk, hash (or skip on resume), upsert
  for await (const entry of walk(scanRoot)) {
    // path_on_drive is always relative to the mount root, not to scanRoot
    const pathOnDrive = relative(mount, entry.absolutePath);

    // Sub-stage D: resume optimization — existing scanned row for (drive, path) with
    // matching size+mtime means the file hasn't changed; skip re-hashing.
    const existing = (await db
      .select({
        locId: locations.id,
        fileId: locations.fileId,
        mtime: locations.mtime,
        fileSize: files.sizeBytes,
      })
      .from(locations)
      .innerJoin(files, eq(files.id, locations.fileId))
      .where(and(
        eq(locations.driveId, driveRow.id),
        eq(locations.pathOnDrive, pathOnDrive),
        eq(locations.verification, 'scanned'),
      )))[0];

    if (existing && existing.fileSize === entry.sizeBytes && existing.mtime === entry.mtime) {
      seenLocationIds.add(existing.locId);
      continue;
    }

    // Hash the file (must happen outside the sync transaction)
    const xxh3 = await hashFile(entry.absolutePath);

    // Sub-stage B: upsert file + location inside a transaction
    db.transaction((tx) => {
      // Upsert files by (xxh3, size)
      const existingFile = tx
        .select()
        .from(files)
        .where(and(eq(files.xxh3, xxh3), eq(files.sizeBytes, entry.sizeBytes)))
        .all()[0];

      let fileId: number;
      if (existingFile) {
        tx.update(files).set({ lastSeen: now() }).where(eq(files.id, existingFile.id)).run();
        fileId = existingFile.id;
      } else {
        const ins = tx
          .insert(files)
          .values({ xxh3, sizeBytes: entry.sizeBytes, firstSeen: now(), lastSeen: now() })
          .returning()
          .all()[0];
        fileId = ins!.id;
      }

      // Upsert location by (file_id, drive_id) — unique constraint
      const existingLoc = tx
        .select()
        .from(locations)
        .where(and(eq(locations.fileId, fileId), eq(locations.driveId, driveRow.id)))
        .all()[0];

      let locId: number;
      if (existingLoc) {
        tx.update(locations)
          .set({ pathOnDrive, verification: 'scanned', mtime: entry.mtime, recordedAt: now() })
          .where(eq(locations.id, existingLoc.id))
          .run();
        locId = existingLoc.id;
      } else {
        const insLoc = tx
          .insert(locations)
          .values({
            fileId,
            driveId: driveRow.id,
            pathOnDrive,
            verification: 'scanned',
            mtime: entry.mtime,
            recordedAt: now(),
          })
          .returning()
          .all()[0];
        locId = insLoc!.id;
      }

      seenLocationIds.add(locId);
    });
  }

  // Sub-stage C: prune scanned locations within the subtree that were NOT seen this run
  const prefix = subtree ? `${subtree}${subtree.endsWith('/') ? '' : '/'}` : '';
  const prefixCondition = subtree
    ? sql`substr(${locations.pathOnDrive}, 1, ${prefix.length}) = ${prefix}`
    : undefined;

  const candidates = await db
    .select({ id: locations.id })
    .from(locations)
    .where(and(
      eq(locations.driveId, driveRow.id),
      eq(locations.verification, 'scanned'),
      ...(prefixCondition ? [prefixCondition] : []),
    ));

  const toPrune = candidates.filter((c) => !seenLocationIds.has(c.id));
  for (const row of toPrune) {
    await db.delete(locations).where(eq(locations.id, row.id)).execute();
  }

  // Sub-stage E: update drive size/free/last_scanned
  let sizeBytes: number | null = null;
  let freeBytes: number | null = null;
  try {
    const sfs = await statfs(mount);
    sizeBytes = Number(sfs.blocks) * sfs.bsize;
    freeBytes = Number(sfs.bfree) * sfs.bsize;
  } catch {
    // statfs not available on this platform; leave nulls
  }

  await db.update(drives).set({ sizeBytes, freeBytes, lastScanned: now() }).where(eq(drives.id, driveRow.id)).execute();

  console.log(`scanned drive ${label} (${seenLocationIds.size} files, pruned ${toPrune.length})`);
}
