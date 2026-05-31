import type { Args } from '../cli';
import { openDb } from '../db/client';
import { drives, locations, files } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { fmtBytes } from '../format';

export async function driveList(_args: Args): Promise<void> {
  const db = await openDb();
  const rows = await db.select().from(drives).orderBy(drives.label);

  console.log(['label', 'uuid', 'capacity', 'free', 'last_scanned', 'files', 'bytes', 'notes'].join('\t'));
  for (const d of rows) {
    const counts = await db
      .select({
        count: sql<number>`count(*)`,
        bytes: sql<number>`coalesce(sum(${files.sizeBytes}), 0)`,
      })
      .from(locations)
      .innerJoin(files, eq(files.id, locations.fileId))
      .where(eq(locations.driveId, d.id));
    const c = counts[0] ?? { count: 0, bytes: 0 };
    console.log([
      d.label,
      d.driveUuid ?? '(unassigned)',
      fmtBytes(d.sizeBytes),
      fmtBytes(d.freeBytes),
      d.lastScanned ?? 'never',
      String(c.count),
      fmtBytes(c.bytes),
      d.notes ?? '',
    ].join('\t'));
  }
}
