import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function makeTmpDir(prefix = 'csc-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function cleanup(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export async function writeTestFile(dir: string, name: string, content: string | Buffer): Promise<string> {
  const path = join(dir, name);
  const parent = path.substring(0, path.lastIndexOf('/'));
  await mkdir(parent, { recursive: true });
  await writeFile(path, content);
  return path;
}
