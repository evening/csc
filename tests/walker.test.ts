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

  it('two runs produce identical order', async () => {
    const a: string[] = []; for await (const e of walk(dir)) a.push(e.relativePath);
    const b: string[] = []; for await (const e of walk(dir)) b.push(e.relativePath);
    expect(a).toEqual(b);
  });
});
