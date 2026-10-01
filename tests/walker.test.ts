import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { walk } from '../src/walker';
import { makeTmpDir, cleanup, writeTestFile } from './helpers';

let dir: string;
beforeAll(async () => {
  dir = await makeTmpDir();
  await writeTestFile(dir, 'b.txt', 'b');
  await writeTestFile(dir, 'a.txt', 'a');
  await writeTestFile(dir, 'sub/c.txt', 'c');
  await writeTestFile(dir, 'sub/nested/d.txt', 'd');
});
afterAll(async () => { await cleanup(dir); });

describe('walk', () => {
  it('yields files in deterministic sorted-path order', async () => {
    const seen: string[] = [];
    for await (const entry of walk(dir)) seen.push(entry.relativePath);
    expect(seen).toEqual(['a.txt', 'b.txt', 'sub/c.txt', 'sub/nested/d.txt']);
  });

  it('yields size and mtime from stat', async () => {
    const entries = [];
    for await (const e of walk(dir)) entries.push(e);
    const a = entries.find((e) => e.relativePath === 'a.txt')!;
    expect(a.sizeBytes).toBe(1);
    expect(a.mtime).toBeGreaterThan(0);
    expect(Number.isInteger(a.mtime)).toBe(true);
  });

  it('skips dotfiles named .csc-drive-id at the root', async () => {
    await writeTestFile(dir, '.csc-drive-id', 'x');
    const seen: string[] = [];
    for await (const e of walk(dir)) seen.push(e.relativePath);
    expect(seen).not.toContain('.csc-drive-id');
  });

  it('skips macOS / Synology / Windows clutter at any depth', async () => {
    const junk = await makeTmpDir();
    await writeTestFile(junk, 'keep.mkv', 'k');
    await writeTestFile(junk, '.DS_Store', 'x');
    await writeTestFile(junk, '._keep.mkv', 'x');
    await writeTestFile(junk, '@eaDir/keep.mkv/SYNOVIDEO_VIDEO_SCREENSHOT.jpg', 'x');
    await writeTestFile(junk, '#recycle/old.mkv', 'x');
    await writeTestFile(junk, '.Spotlight-V100/store.db', 'x');
    await writeTestFile(junk, 'show/@eaDir/thumb.jpg', 'x');
    await writeTestFile(junk, 'show/Thumbs.db', 'x');
    await writeTestFile(junk, 'show/ep1.mkv', 'e');
    const seen: string[] = [];
    for await (const e of walk(junk)) seen.push(e.relativePath);
    expect(seen).toEqual(['keep.mkv', 'show/ep1.mkv']);
    await cleanup(junk);
  });

  it('does not skip ordinary dotfiles or names that merely contain a clutter name', async () => {
    const d = await makeTmpDir();
    await writeTestFile(d, '.hidden-but-real', 'x');
    await writeTestFile(d, 'my@eaDir-notes.txt', 'x');
    const seen: string[] = [];
    for await (const e of walk(d)) seen.push(e.relativePath);
    expect(seen).toEqual(['.hidden-but-real', 'my@eaDir-notes.txt']);
    await cleanup(d);
  });

  it('two runs produce identical order', async () => {
    const a: string[] = []; for await (const e of walk(dir)) a.push(e.relativePath);
    const b: string[] = []; for await (const e of walk(dir)) b.push(e.relativePath);
    expect(a).toEqual(b);
  });
});
