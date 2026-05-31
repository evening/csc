import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { whereis } from '../../src/commands/whereis';
import { scan } from '../../src/commands/scan';
import { driveAdd } from '../../src/commands/drive-add';
import { makeTmpDir, cleanup, writeTestFile } from '../helpers';
import { join } from 'node:path';

let workDir: string;
let drive: string;
let nas: string;
let lines: string[] = [];

beforeEach(async () => {
  workDir = await makeTmpDir();
  process.env.CSC_DB = join(workDir, 'catalog.db');
  drive = join(workDir, 'drive');
  nas = join(workDir, 'nas');
  await writeTestFile(drive, '.keep', '');
  await writeTestFile(nas, '.keep', '');
  await driveAdd({ positional: ['hd3'], flags: {} });
  lines = [];
  spyOn(console, 'log').mockImplementation((s: string) => { lines.push(s); });
});
afterEach(async () => {
  delete process.env.CSC_DB;
  await cleanup(workDir);
});

describe('whereis', () => {
  it('locates a file by nas path on its scanned drive', async () => {
    await writeTestFile(drive, 'movie.mkv', 'X');
    await writeTestFile(nas, 'movie.mkv', 'X');
    await scan({ positional: ['hd3'], flags: { mount: drive } });
    lines = [];
    await whereis({ positional: [join(nas, 'movie.mkv')], flags: {} });
    const out = lines.join('\n');
    expect(out).toContain('hd3');
    expect(out).toContain('scanned');
  });

  it('accepts a raw hash as argument', async () => {
    await writeTestFile(drive, 'movie.mkv', 'X');
    await scan({ positional: ['hd3'], flags: { mount: drive } });
    // fetch the actual stored hash
    const { openDb } = await import('../../src/db/client');
    const { files } = await import('../../src/db/schema');
    const db = await openDb();
    const fileRows = await db.select().from(files);
    // pick the file row corresponding to 'X' (sizeBytes === 1)
    const target = fileRows.find((f) => f.sizeBytes === 1)!;
    lines = [];
    await whereis({ positional: [target.xxh3], flags: {} });
    expect(lines.join('\n')).toContain('hd3');
  });

  it('reports nothing-found for an unknown file', async () => {
    await writeTestFile(nas, 'orphan.mkv', 'Y');
    lines = [];
    await whereis({ positional: [join(nas, 'orphan.mkv')], flags: {} });
    expect(lines.join('\n')).toMatch(/not in catalog/i);
  });
});
