import type { Args } from '../cli';
import { openDb } from '../db/client';
import { drives, files, locations, nasHashCache } from '../db/schema';
import { walk } from '../walker';
import { hashFile } from '../hash';
import { Progress, progressEnabled } from '../progress';
import { and, eq } from 'drizzle-orm';
import { fmtBytes } from '../format';
import { resolve } from 'node:path';

export async function check(args: Args): Promise<void> {
  // absolute paths, so the NAS hash cache is keyed the same regardless of cwd
  const roots = args.positional.map((p) => resolve(p));
  if (roots.length === 0) throw new Error('path required: csc check <nas-path>...');
  const summary = args.flags.summary === true;

  const db = await openDb();
  let total = 0;
  let backed = 0;
  let assertedOnly = 0;
  let missing = 0;
  let unbackedBytes = 0;

  const progress = new Progress('checking', progressEnabled(args.flags));
  const out = (s: string) => { if (!summary) progress.log(s); };

  try {
    for (const root of roots) {
      for await (const entry of walk(root)) {
        total++;
        progress.file();
        // Cache lookup
        const cached = (await db.select().from(nasHashCache).where(eq(nasHashCache.path, entry.absolutePath)))[0];
        let xxh3: string;
        if (cached && cached.sizeBytes === entry.sizeBytes && cached.mtime === entry.mtime) {
          xxh3 = cached.xxh3;
        } else {
          xxh3 = await hashFile(entry.absolutePath, (n) => progress.hashed(n));
          await db.insert(nasHashCache).values({
            path: entry.absolutePath, sizeBytes: entry.sizeBytes, mtime: entry.mtime,
            xxh3, cachedAt: new Date().toISOString(),
          }).onConflictDoUpdate({
            target: nasHashCache.path,
            set: { sizeBytes: entry.sizeBytes, mtime: entry.mtime, xxh3, cachedAt: new Date().toISOString() },
          });
        }

        // Look up the file's locations
        const fileRow = (await db.select().from(files)
          .where(and(eq(files.xxh3, xxh3), eq(files.sizeBytes, entry.sizeBytes))))[0];

        if (!fileRow) {
          out(`✗ ${entry.absolutePath}  not backed up`);
          missing++;
          unbackedBytes += entry.sizeBytes;
          continue;
        }

        const locRows = await db.select({
          verification: locations.verification,
          pathOnDrive: locations.pathOnDrive,
          label: drives.label,
        }).from(locations)
          .innerJoin(drives, eq(drives.id, locations.driveId))
          .where(eq(locations.fileId, fileRow.id));

        const scanned = locRows.filter((r) => r.verification === 'scanned');
        const asserted = locRows.filter((r) => r.verification === 'asserted');

        if (scanned.length > 0) {
          backed++;
          const labels = scanned.map((r) => r.label).join(', ');
          const extra = asserted.length > 0 ? `  (also asserted on ${asserted.map((r) => r.label).join(', ')})` : '';
          out(`✓ ${entry.absolutePath}  ${labels}${extra}`);
        } else if (asserted.length > 0) {
          assertedOnly++;
          const labels = asserted.map((r) => r.label).join(', ');
          out(`⚠ ${entry.absolutePath}  ${labels} (asserted, unverified)`);
        } else {
          // file exists in catalog but has no locations — shouldn't happen, treat as missing
          missing++;
          unbackedBytes += entry.sizeBytes;
          out(`✗ ${entry.absolutePath}  not backed up`);
        }
      }
    }
  } finally {
    progress.done();
  }

  if (summary) {
    console.log(`${total} files, ${backed} backed up, ${assertedOnly} asserted-only, ${missing} not backed up, ${fmtBytes(unbackedBytes)} unbacked`);
  }
}
