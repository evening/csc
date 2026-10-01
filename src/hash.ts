import { XXHash3 } from 'xxhash-addon';
import { createReadStream } from 'node:fs';

const CHUNK_BYTES = 1024 * 1024;
const SEED = Buffer.alloc(4); // 4-byte zero seed for standard xxh3

export function hashBytes(bytes: Buffer): string {
  const h = new XXHash3(SEED);
  h.update(bytes);
  return h.digest().toString('hex').padStart(16, '0');
}

export function hashFile(path: string, onBytes?: (n: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = new XXHash3(SEED);
    const stream = createReadStream(path, { highWaterMark: CHUNK_BYTES });
    stream.on('data', (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      h.update(buf);
      onBytes?.(buf.length);
    });
    stream.on('end', () => {
      resolve(h.digest().toString('hex').padStart(16, '0'));
    });
    stream.on('error', reject);
  });
}
