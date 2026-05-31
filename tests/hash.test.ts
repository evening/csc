import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { hashFile, hashBytes } from '../src/hash';
import { makeTmpDir, cleanup, writeTestFile } from './helpers';

let dir: string;
beforeAll(async () => { dir = await makeTmpDir(); });
afterAll(async () => { await cleanup(dir); });

describe('hash', () => {
  it('hashBytes returns 16-char lowercase hex', () => {
    const h = hashBytes(Buffer.from('hello world'));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('hashBytes is deterministic', () => {
    const a = hashBytes(Buffer.from('hello'));
    const b = hashBytes(Buffer.from('hello'));
    expect(a).toBe(b);
  });

  it('hashBytes differs for different inputs', () => {
    const a = hashBytes(Buffer.from('hello'));
    const b = hashBytes(Buffer.from('hellp'));
    expect(a).not.toBe(b);
  });

  it('hashFile matches hashBytes for small file', async () => {
    const content = Buffer.from('the quick brown fox');
    const path = await writeTestFile(dir, 'small.txt', content);
    expect(await hashFile(path)).toBe(hashBytes(content));
  });

  it('hashFile handles multi-chunk file correctly', async () => {
    const content = Buffer.alloc(3 * 1024 * 1024); // 3 MB > 1 MB chunk size
    for (let i = 0; i < content.length; i++) content[i] = i & 0xff;
    const path = await writeTestFile(dir, 'big.bin', content);
    expect(await hashFile(path)).toBe(hashBytes(content));
  });

  it('hashFile differs when file content differs by one byte', async () => {
    const a = Buffer.alloc(1024, 0x00);
    const b = Buffer.alloc(1024, 0x00); b[500] = 0x01;
    const pa = await writeTestFile(dir, 'a.bin', a);
    const pb = await writeTestFile(dir, 'b.bin', b);
    expect(await hashFile(pa)).not.toBe(await hashFile(pb));
  });
});
