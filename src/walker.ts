import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { SENTINEL_FILENAME } from './sentinel';

export interface WalkEntry {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  mtime: number; // epoch seconds, integer
}

// OS / NAS clutter that is never worth cataloging. Matched by exact name at any
// depth; a matching directory is skipped along with everything under it.
export const IGNORED_NAMES = new Set([
  // macOS
  '.DS_Store',
  '.fseventsd',
  '.Spotlight-V100',
  '.Trashes',
  '.TemporaryItems',
  '.DocumentRevisions-V100',
  '.metadata_never_index',
  // Synology
  '@eaDir',
  '#recycle',
  '#snapshot',
  // Windows
  'Thumbs.db',
  'desktop.ini',
  '$RECYCLE.BIN',
  'System Volume Information',
]);

export function isIgnored(name: string): boolean {
  // AppleDouble sidecars macOS writes next to files on non-Apple filesystems
  return IGNORED_NAMES.has(name) || name.startsWith('._');
}

export async function* walk(root: string): AsyncIterable<WalkEntry> {
  yield* walkInner(root, root);
}

async function* walkInner(root: string, dir: string): AsyncIterable<WalkEntry> {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (isIgnored(entry.name)) continue;
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
