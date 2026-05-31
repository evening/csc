import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import * as schema from './schema';
import { dbPath } from '../config';

export type DB = BunSQLiteDatabase<typeof schema>;

export async function openDb(path: string = dbPath()): Promise<DB> {
  await mkdir(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: join(import.meta.dir, '../../drizzle') });
  return db;
}
