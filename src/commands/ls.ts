import type { Args } from '../cli';
import { openDb } from '../db/client';
import { drives, files, locations } from '../db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { fmtBytes } from '../format';

export async function ls(args: Args): Promise<void> {
  const label = args.positional[0];
  if (!label) throw new Error('label required: csc ls <label> [subpath]');
  const subpath = (args.positional[1] ?? '').replace(/\/+$/, '');

  const db = await openDb();
  const drv = (await db.select().from(drives).where(eq(drives.label, label)))[0];
  if (!drv) throw new Error(`unknown drive label: ${label}`);

  // exact-prefix match, not LIKE — `_` in directory names breaks LIKE
  const prefix = subpath ? `${subpath}/` : '';
  const prefixCondition = subpath
    ? sql`substr(${locations.pathOnDrive}, 1, ${prefix.length}) = ${prefix}`
    : undefined;

  const rows = await db.select({
    path: locations.pathOnDrive,
    size: files.sizeBytes,
    verification: locations.verification,
  }).from(locations)
    .innerJoin(files, eq(files.id, locations.fileId))
    .where(and(eq(locations.driveId, drv.id), ...(prefixCondition ? [prefixCondition] : [])))
    .orderBy(locations.pathOnDrive);

  const width = rows.reduce((w, r) => Math.max(w, r.path.length), 0);
  let totalBytes = 0;
  for (const r of rows) {
    totalBytes += r.size;
    const marker = r.verification === 'asserted' ? '   (asserted)' : '';
    console.log(`${r.path.padEnd(width)}  ${fmtBytes(r.size).padStart(9)}${marker}`);
  }
  console.log(`${rows.length} files, ${fmtBytes(totalBytes)}`);
}
