import { sqliteTable, integer, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const drives = sqliteTable('drives', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull().unique(),
  driveUuid: text('drive_uuid').unique(),
  sizeBytes: integer('size_bytes'),
  freeBytes: integer('free_bytes'),
  lastScanned: text('last_scanned'),
  notes: text('notes'),
});

export const files = sqliteTable(
  'files',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    xxh3: text('xxh3').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    firstSeen: text('first_seen').notNull(),
    lastSeen: text('last_seen').notNull(),
  },
  (t) => ({
    identityIdx: uniqueIndex('files_identity').on(t.xxh3, t.sizeBytes),
  }),
);

export const locations = sqliteTable(
  'locations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fileId: integer('file_id').notNull().references(() => files.id),
    driveId: integer('drive_id').notNull().references(() => drives.id),
    pathOnDrive: text('path_on_drive').notNull(),
    verification: text('verification', { enum: ['scanned', 'asserted'] }).notNull(),
    mtime: integer('mtime'), // epoch seconds, null for asserted rows
    recordedAt: text('recorded_at').notNull(),
  },
  (t) => ({
    fileDriveIdx: uniqueIndex('locations_file_drive').on(t.fileId, t.driveId),
  }),
);

export const nasHashCache = sqliteTable('nas_hash_cache', {
  path: text('path').primaryKey(),
  sizeBytes: integer('size_bytes').notNull(),
  mtime: integer('mtime').notNull(),
  xxh3: text('xxh3').notNull(),
  cachedAt: text('cached_at').notNull(),
});
