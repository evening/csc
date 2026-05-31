import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { SENTINEL_FILENAME } from './sentinel';

export interface WalkEntry {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  mtime: number; // epoch seconds, integer
}

export async function* walk(root: string): AsyncIterable<WalkEntry> {
  yield* walkInner(root, root);
}

async function* walkInner(root: string, dir: string): AsyncIterable<WalkEntry> {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);
    const relativePath = relative(root, absolutePath);
    if (relativePath === SENTINEL_FILENAME) continue;
    if (entry.isDirectory()) {
      yield* walkInner(root, absolutePath);
    } else if (entry.isFile()) {
      const s = await stat(absolutePath);
      yield {
        absolutePath,
        relativePath,
        sizeBytes: s.size,
        mtime: Math.floor(s.mtimeMs / 1000),
      };
    }
    // symlinks and other types are skipped
  }
}
