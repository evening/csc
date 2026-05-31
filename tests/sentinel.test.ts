import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { readSentinel, writeSentinel, SENTINEL_FILENAME } from '../src/sentinel';
import { makeTmpDir, cleanup } from '../tests/helpers';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

let dir: string;
beforeAll(async () => { dir = await makeTmpDir(); });
afterAll(async () => { await cleanup(dir); });

describe('sentinel', () => {
  it('readSentinel returns null when missing', async () => {
    expect(await readSentinel(dir)).toBeNull();
  });

  it('writeSentinel then readSentinel returns a matching uuid', async () => {
    const written = await writeSentinel(dir, 'hd3');
    expect(written.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const read = await readSentinel(dir);
    expect(read).not.toBeNull();
    expect(read!.uuid).toBe(written.uuid);
    expect(read!.labelAtCreation).toBe('hd3');
  });

  it('throws on malformed sentinel', async () => {
    const bad = join(dir, SENTINEL_FILENAME);
    await writeFile(bad, 'this is not a sentinel\n');
    await expect(readSentinel(dir)).rejects.toThrow(/csc-drive-id/);
    await unlink(bad);
  });

  it('sentinel file is at drive root with expected name', async () => {
    await writeSentinel(dir, 'hd9');
    const expected = join(dir, '.csc-drive-id');
    const content = await Bun.file(expected).text();
    expect(content).toContain('csc-drive-id:');
    expect(content).toContain('label-at-creation: hd9');
    expect(content).toContain('cold storage catalog sentinel');
  });
});
